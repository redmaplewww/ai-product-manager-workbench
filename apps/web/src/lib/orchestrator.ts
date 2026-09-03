import "server-only";
import OpenAI from "openai";
import { Agent, OpenAIProvider, Runner, setDefaultModelProvider } from "@openai/agents";
import { z } from "zod";
import { providerBaseUrl } from "./env";
import {
  assembleProductContext,
  agentPacketOutputSchema,
  classifyTurnIntent,
  pmSynthesisOutputSchema,
  planMemoryUpdates,
  type ProductBaseline,
  type AgentPacket,
  type StudioState,
  type TurnIntent
} from "@pm-studio/core";
import { id, now } from "./ids";
import { getAgent } from "./agents/catalog";
import { buildProposal, proposalSourcesFromPackets, supportedProposalCategories, type PmProposal, type ProposalSource } from "./proposal-builder";
import { formatAgentResults } from "./agent-result";
import { extractMemory } from "./tools/memory-extractor";
import { failedAgentPacket, normalizeAgentPacket } from "./agent-packet";

setDefaultModelProvider(new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: providerBaseUrl("openai")
}));
const agentRunner = new Runner({ tracingDisabled: true });

const expertOutputSchema = agentPacketOutputSchema;
const proposalItemSchema = z.object({ itemIds: z.array(z.string().min(1)).min(1).max(4), category: z.enum(supportedProposalCategories), content: z.string().trim().min(1).max(1000), selected: z.boolean().default(true) });
const legacyProposalChangeSchema = z.object({ path: z.string(), after: z.string(), selected: z.boolean().default(true) });
const legacyProposalSchema = z.object({ title: z.string(), rationale: z.string(), changes: z.array(legacyProposalChangeSchema).max(8) });
const legacyPmOutputSchema = z.object({ answer: z.string(), reviewResponses: z.array(z.object({ issueId: z.string(), disposition: z.enum(["surfaced", "resolved", "needs_clarification"]), message: z.string() })).default([]), proposalTitle: z.string().trim().min(1).max(120).nullable().default(null), proposalRationale: z.string().trim().min(1).max(600).nullable().default(null), proposal: z.union([z.array(proposalItemSchema).max(8), legacyProposalSchema]).nullable().default(null) });

type NormalizedPmOutput = z.infer<typeof pmSynthesisOutputSchema>;

type ReviewResponse = { issueId: string; disposition: "surfaced" | "resolved" | "needs_clarification"; message: string };

export function composePmAnswer(answer: string, reviewResponses: ReviewResponse[], critic: AgentPacket) {
  const issueIds = critic.issues.map((issue) => issue.id);
  if (issueIds.some((issueId) => !reviewResponses.some((response) => response.issueId === issueId))) throw new Error("UNHANDLED_CRITIC_ISSUE");
  const visibleReview = reviewResponses.filter((response) => issueIds.includes(response.issueId)).map((response) => `- ${response.message}`);
  const visibleQuestions = critic.clarificationQuestions.map((question) => `- ${question.content}`);
  const sections = [
    visibleReview.length ? `审查发现\n${visibleReview.join("\n")}` : "",
    visibleQuestions.length ? `待确认问题\n${visibleQuestions.join("\n")}` : "",
    answer
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function ensureCriticIssueCoverage(expertPackets: AgentPacket[], critic: AgentPacket): AgentPacket {
  const covered = new Set(critic.issues.flatMap((issue) => issue.targetRefs));
  const missing = expertPackets.flatMap((packet) => packet.issues).filter((issue) => !covered.has(issue.id));
  if (!missing.length) return critic;
  const issues = [...critic.issues, ...missing.map((issue, index) => ({
    id: `issue:critical-reviewer:coverage:${index}`,
    kind: issue.kind,
    severity: issue.severity,
    targetRefs: [issue.id],
    detail: `专家报告的问题尚未获得批判评审核验：${issue.detail}`,
    evidenceIds: issue.evidenceIds,
    verification: "unresolved" as const
  }))];
  return { ...critic, issues };
}

function comparableProposalText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizePmOutput(value: unknown, sources: ProposalSource[]): NormalizedPmOutput {
  if (typeof value !== "object" || value === null) return pmSynthesisOutputSchema.parse(value);
  const input = value as Record<string, unknown>;
  if ("proposalItems" in input) return pmSynthesisOutputSchema.parse({
    answer: input.answer,
    reviewResponses: input.reviewResponses ?? [],
    proposalTitle: input.proposalTitle ?? null,
    proposalRationale: input.proposalRationale ?? null,
    proposalItems: input.proposalItems ?? []
  });
  const output = legacyPmOutputSchema.parse(input);
  const proposal = output.proposal;
  if (!proposal) return { answer: output.answer, reviewResponses: output.reviewResponses, proposalTitle: output.proposalTitle, proposalRationale: output.proposalRationale, proposalItems: [] };
  if (Array.isArray(proposal)) return { answer: output.answer, reviewResponses: output.reviewResponses, proposalTitle: output.proposalTitle, proposalRationale: output.proposalRationale, proposalItems: proposal };

  const items = proposal.changes.flatMap((change) => {
    const category = change.path.split("/")[1];
    if (!supportedProposalCategories.includes(category as (typeof supportedProposalCategories)[number])) return [];
    const source = sources.find((candidate) => comparableProposalText(candidate.content) === comparableProposalText(change.after));
    if (!source) return [];
    return [{ itemIds: [source.id], category: category as (typeof supportedProposalCategories)[number], content: change.after, selected: change.selected }];
  });

  return { answer: output.answer, reviewResponses: output.reviewResponses, proposalTitle: output.proposalTitle || proposal.title, proposalRationale: output.proposalRationale || proposal.rationale, proposalItems: items };
}

export function normalizeReviewOutput(raw: string, evidenceIds: string[], targetRefs: string[]): AgentPacket {
  try {
    return normalizeAgentPacket("critical-reviewer", JSON.parse(raw), evidenceIds, targetRefs);
  } catch (error) {
    return failedAgentPacket("critical-reviewer", error instanceof Error ? error.message : String(error));
  }
}

type ExpertResult = {
  agentId: string;
  agent: string;
  provider: string;
  model: string;
  summary: string;
  result: AgentPacket;
  durationMs: number;
  retries: number;
};

const structuredAgentIds = ["requirements-analyst", "domain-analyst", "delivery-planner"] as const;

function requiredAgent(id: string) {
  const agent = getAgent(id);
  if (!agent) throw new Error(`AGENT_NOT_REGISTERED:${id}`);
  return agent;
}

function localExpert(agentId: string, agent: string, content: string, intent: TurnIntent, provider = "Demo", model = "demo-structured", retries = 0): ExpertResult {
  const focus = content.length > 72 ? `${content.slice(0, 72)}...` : content;
  const summaries: Record<string, string> = {
    "需求分析": `识别为“${intent}”意图；核心表述是“${focus}”。已区分新增事实、操作请求和待确认内容。`,
    "领域分析": "结合正式基线检查了用户、流程、数据、运营、合规和审批边界，未把候选信息当作已确认事实。",
    "交付规划": intent === "planning"
      ? "建议按 Outcome → Capability → Epic → WorkItem → AcceptanceCriterion 组织，并先补齐目标、依赖和验收证据。"
      : "本轮先更新产品理解；只有可执行的新事实进入候选提案，纯提问和重复表述不创建变更。",
    "批判评审": "已检查事实冲突、无来源推断、重复记忆和越权修改基线风险。"
  };
  const summary = summaries[agent];
  return { agentId, agent, provider, model, summary, result: normalizeAgentPacket(agentId, { summary, assertions: [], clarificationQuestions: [], issues: [] }, []), durationMs: 20 + agent.length * 7, retries };
}

async function openAiExpert(agentId: string, agentName: string, instructions: string, input: string, content: string, intent: TurnIntent, evidenceIds: string[]): Promise<ExpertResult> {
  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  let failureReason = "UNKNOWN_EXPERT_FAILURE";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const agent = new Agent({
        name: agentName,
        model,
        outputType: expertOutputSchema,
        instructions: `${instructions}\n只返回结构化结论，不输出思维链。明确区分正式基线、已确认记忆、候选记忆和不可信外部资料。grounded assertion 的 evidenceIds 必须至少引用一个下列 ID；assumption 的 evidenceIds 必须为空；不得编造 ID。assertions 必须是本 Agent 按职责整理后的最终交付条目，不要输出思考过程。\n[允许引用的 Evidence IDs]\n${evidenceIds.join("\n")}`
      });
      const result = await agentRunner.run(agent, input);
      const output = normalizeAgentPacket(agentId, result.finalOutput, evidenceIds);
      const details = [...output.assertions.map((item) => item.content), ...output.clarificationQuestions.map((item) => `待确认：${item.content}`)].slice(0, 4);
      return {
        agentId,
        agent: agentName,
        provider: "OpenAI",
        model,
        summary: [output.summary, ...details].join("；").slice(0, 900),
        result: output,
        durationMs: Date.now() - started,
        retries: attempt
      };
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      // One bounded retry is recorded in the transparent run trace.
    }
  }
  const fallback = { ...localExpert(agentId, agentName, content, intent, "Demo (OpenAI 降级)", "local-rules", 2), result: failedAgentPacket(agentId, failureReason.slice(0, 500)) };
  fallback.durationMs = Date.now() - started;
  fallback.summary = `OpenAI 专家调用失败，已自动降级。${fallback.summary}`;
  return fallback;
}

async function deepSeekReview(input: string, content: string, intent: TurnIntent, evidenceIds: string[], targetRefs: string[]): Promise<ExpertResult> {
  if (!process.env.DEEPSEEK_API_KEY) return localExpert("critical-reviewer", "批判评审", content, intent, "Demo", "demo-review");
  const model = process.env.DEEPSEEK_REVIEW_MODEL || "deepseek-v4-pro";
  const started = Date.now();
  const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: providerBaseUrl("deepseek") });
  let failureReason = "DEEPSEEK_REVIEW_FAILURE";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${requiredAgent("critical-reviewer").prompt}\n只返回 JSON object，字段必须为 summary、assertions、clarificationQuestions、issues。批判 Agent 的 assertions 必须为空。每个 issue 必须有 kind、severity、targetRefs、detail、evidenceIds；每个 clarificationQuestion 必须有 content、evidenceIds。只能使用提供的 Evidence IDs 和 targetRefs，不得编造。` },
          { role: "user", content: `${input}\n\n[允许引用的 Evidence IDs]\n${evidenceIds.join("\n")}\n\n[允许引用的专家 Item IDs]\n${targetRefs.join("\n")}` }
        ]
      });
      const reviewText = response.choices[0]?.message.content || "未发现新增风险";
      const result = normalizeReviewOutput(reviewText, evidenceIds, targetRefs);
      return {
        agentId: "critical-reviewer", agent: "批判评审",
        provider: "DeepSeek",
        model,
        summary: result.summary,
        result,
        durationMs: Date.now() - started,
        retries: attempt
      };
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      // One bounded retry keeps transient provider failures recoverable.
    }
  }
  const fallback = { ...localExpert("critical-reviewer", "批判评审", content, intent, "Demo (DeepSeek 降级)", "local-rules", 2), result: failedAgentPacket("critical-reviewer", failureReason.slice(0, 500)) };
  fallback.durationMs = Date.now() - started;
  fallback.summary = `DeepSeek 评审调用失败，已自动降级。${fallback.summary}`;
  return fallback;
}

function localPmAnswer(content: string, intent: TurnIntent, baseline: ProductBaseline, experts: ExpertResult[]) {
  if (intent === "question") {
    return `基于当前已批准产品基线，我的回答是：${baseline.summary}\n\n当前必须遵守的边界包括：${baseline.requirements.slice(0, 3).join("；")}。正式决策是：${baseline.decisions.slice(0, 3).join("；")}。\n\n本轮是问答，不会因此创建基线变更；如果你的问题实际包含一项新决定，请明确说“确定采用……”或“必须……”。`;
  }
  if (intent === "planning") {
    return `我会把“${content}”作为规划请求处理，而不是直接当成新的产品事实。\n\n建议拆分：\nOutcome：明确期望结果和度量指标\nCapability：形成支撑该结果的稳定能力\nEpic：按可独立评审的产品增量组织\nWorkItem：补齐类型、优先级、依赖、负责人角色、估算和风险\nAcceptanceCriterion：每项工作至少包含一个可重复验证的通过条件\n\n${experts.find((item) => item.agent === "批判评审")?.summary || ""}`;
  }
  return `我已完成本轮产品分析。正式基线不会被自动修改；有明确依据的变更会整理为待审批提案。\n\n${experts.find((item) => item.agent === "批判评审")?.summary || ""}`;
}

async function synthesizePmAnswer(
  input: string,
  content: string,
  intent: TurnIntent,
  baseline: ProductBaseline,
  experts: ExpertResult[],
  critic: AgentPacket,
  sources: ProposalSource[]
): Promise<{
  answer: string;
  status: "completed" | "failed";
  provider: string;
  model: string;
  retries: number;
  durationMs: number;
  proposal: ReturnType<typeof buildProposal>;
  output: unknown;
  fallbackReason?: string;
}> {
  const fallback = localPmAnswer(content, intent, baseline, experts);
  if (!process.env.OPENAI_API_KEY) return { answer: composePmAnswer(fallback, critic.issues.map((issue) => ({ issueId: issue.id, disposition: "needs_clarification" as const, message: issue.detail })), critic), status: "completed", provider: "Demo", model: "local-pm", retries: 0, durationMs: 15, proposal: buildProposal(sources), output: { answer: fallback } };
  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  let fallbackReason = "未知错误";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const agent = new Agent({
        name: requiredAgent("pm-synthesizer").name,
        model,
        outputType: pmSynthesisOutputSchema,
        instructions: `${requiredAgent("pm-synthesizer").prompt}\nproposalItems 只能引用给定 AgentPacket 的最终交付条目。每个数组项必须填写 itemIds；itemIds 可以引用多个条目，也可以被多个 item 复用。选择与基线一致的 category，并把内容重新组织为产品条目；不要新增专家结论之外的功能、范围或要求。`
      });
      const result = await agentRunner.run(agent, `${input}\n\n[允许引用的提案候选]\n${JSON.stringify(sources)}`);
      const output = normalizePmOutput(result.finalOutput, sources);
      const pmProposal = output.proposalItems.length
        ? { title: output.proposalTitle || "本轮产品基线候选变更", rationale: output.proposalRationale || "PM 已将本轮内容整理为候选变更，审批通过后才会写入正式基线。", items: output.proposalItems }
        : undefined;
      return { answer: composePmAnswer(output.answer, output.reviewResponses, critic), status: "completed", provider: "OpenAI", model, retries: attempt, durationMs: Date.now() - started, proposal: buildProposal(sources, pmProposal as PmProposal), output };
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error);
      // Retry once, then keep the turn available with a deterministic answer.
    }
  }
  const fallbackAnswer = composePmAnswer(fallback, critic.issues.map((issue) => ({ issueId: issue.id, disposition: "needs_clarification" as const, message: issue.detail })), critic);
  return { answer: fallbackAnswer, status: "failed", provider: "Demo (OpenAI 降级)", model: "local-pm", retries: 2, durationMs: Date.now() - started, proposal: null, fallbackReason: fallbackReason.slice(0, 300), output: { answer: fallbackAnswer, fallbackReason: fallbackReason.slice(0, 300) } };
}

export async function executeTurn(state: StudioState, projectId: string, content: string, actorName: string) {
  const project = state.projects.find((item) => item.id === projectId);
  const artifact = state.artifactVersions.filter((item) => item.projectId === projectId).sort((a, b) => b.version - a.version)[0];
  if (!project || !artifact) throw new Error("PROJECT_NOT_FOUND");

  const createdAt = now();
  const runId = id("run");
  const messageId = id("msg");
  const demoMode = !process.env.OPENAI_API_KEY;
  state.messages.push({ id: messageId, projectId, role: "user", author: actorName, content, citations: [], createdAt });
  const run: StudioState["runs"][number] = {
    id: runId, projectId, status: "running", costUsd: 0, durationMs: 0, demoMode, createdAt, steps: []
  };
  state.runs.unshift(run);
  const started = Date.now();
  const intent = classifyTurnIntent(content);
  const context = assembleProductContext(state, projectId, artifact.baseline, content, 12000, artifact.version);
  const expertInput = `${context.text}\n\n[本轮用户输入]\n${content}`;
  const expertSpecs = structuredAgentIds.map((agentId) => {
    const agent = requiredAgent(agentId);
    return [agentId, agent.name, agent.prompt] as const;
  });

  const experts = demoMode
    ? expertSpecs.map(([agentId, name]) => localExpert(agentId, name, content, intent))
    : await Promise.all(expertSpecs.map(([agentId, name, instructions]) => openAiExpert(agentId, name, instructions, expertInput, content, intent, context.evidenceCatalog.map((item) => item.id))));
  const proposalCandidates = proposalSourcesFromPackets(experts.map((item) => item.result));
  const reviewInput = `${expertInput}\n\n[专家结构化结论]\n${formatAgentResults(experts)}`;
  const review = await deepSeekReview(reviewInput, content, intent, context.evidenceCatalog.map((item) => item.id), experts.flatMap((item) => [...item.result.assertions.map((entry) => entry.id), ...item.result.clarificationQuestions.map((entry) => entry.id), ...item.result.issues.map((entry) => entry.id)]));
  review.result = ensureCriticIssueCoverage(experts.map((item) => item.result), review.result);
  experts.push(review);

  const pmInput = `${reviewInput}\n\n[批判评审结构化结论]\n${JSON.stringify(review.result)}\n\n[提案候选门槛]\n${JSON.stringify({ willCreateProposal: proposalCandidates.length > 0, candidateCount: proposalCandidates.length })}`;
  const pm = await synthesizePmAnswer(pmInput, content, intent, artifact.baseline, experts, review.result, proposalCandidates);
  const memoryPlan = extractMemory({ content, memories: state.memories.filter((item) => item.projectId === projectId), sourceMessageId: messageId });
  const answerCreatedAt = now();
  const actorId = state.users.find((item) => item.name === actorName)?.id || actorName;
  state.messages.push({
    id: id("msg"), projectId, role: "assistant", author: "AI 产品经理", content: pm.answer,
    citations: context.citationIds, runId, createdAt: answerCreatedAt
  });

  for (const merge of memoryPlan.merges) {
    const memory = state.memories.find((item) => item.id === merge.memoryId);
    if (memory && !memory.sourceMessageIds.includes(merge.sourceMessageId)) {
      memory.sourceMessageIds.push(merge.sourceMessageId);
      memory.updatedAt = answerCreatedAt;
      state.auditEvents.unshift({ id: id("audit"), actorId, action: "memory.source_merged", target: memory.id, detail: `source ${merge.sourceMessageId}`, createdAt: answerCreatedAt });
    }
  }
  for (const draft of memoryPlan.creates) {
    const memoryId = id("mem");
    state.memories.unshift({
      id: memoryId, projectId, type: draft.type, content: draft.content, confidence: draft.confidence,
      status: "candidate", sourceMessageIds: [messageId], conflictWithId: draft.conflictWithId,
      createdAt: answerCreatedAt, updatedAt: answerCreatedAt
    });
    state.auditEvents.unshift({ id: id("audit"), actorId, action: "memory.candidate_created", target: memoryId, detail: draft.type, createdAt: answerCreatedAt });
  }

  const proposalDraft = pm.proposal;
  const proposal = proposalDraft ? {
    id: id("prop"),
    projectId,
    title: proposalDraft.title,
    rationale: proposalDraft.rationale,
    baseVersion: project.baselineVersion,
    status: "pending" as const,
    changes: proposalDraft.changes,
    createdByRunId: runId,
    createdAt: answerCreatedAt
  } : null;
  if (proposal) {
    state.proposals.unshift(proposal);
    project.pendingProposals += 1;
  }

  run.steps.push(
    ...experts.map((item) => ({
      id: id("step"), agent: item.agent, provider: item.provider, model: item.model, status: item.result.status,
      summary: item.summary, result: item.result, durationMs: item.durationMs, retries: item.retries, startedAt: createdAt
    })),
    {
      id: id("step"), agent: "PM 综合", provider: pm.provider, model: pm.model, status: pm.status,
      summary: `${pm.fallbackReason ? `PM 调用失败：${pm.fallbackReason}。` : ""}${pm.answer}`.slice(0, 900), output: { ...(typeof pm.output === "object" && pm.output !== null ? pm.output as Record<string, unknown> : { answer: pm.answer }), proposalCandidates },
      durationMs: pm.durationMs, retries: pm.retries, startedAt: createdAt
    },
    {
      id: id("step"), agent: "记忆整理", provider: "Local", model: "memory-policy-v2", status: "completed" as const,
      summary: `新增 ${memoryPlan.creates.length} 条候选，合并 ${memoryPlan.merges.length} 条重复来源，命中 ${memoryPlan.blockingConflictIds.length} 项阻断冲突。`,
      durationMs: 8, retries: 0, startedAt: createdAt
    }
  );
  project.openQuestions = artifact.baseline.openQuestions.length + state.memories.filter((item) => item.projectId === projectId && item.status === "candidate" && ["open_question", "conflict"].includes(item.type)).length;
  project.updatedAt = answerCreatedAt;
  run.status = "completed";
  run.durationMs = Date.now() - started;
  run.costUsd = demoMode ? 0 : Number(process.env.PM_STUDIO_ESTIMATED_RUN_COST_USD || 0.02);
  run.completedAt = now();
  return { run, proposal };
}
