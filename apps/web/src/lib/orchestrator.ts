import "server-only";
import OpenAI from "openai";
import { Agent, OpenAIProvider, Runner, setDefaultModelProvider } from "@openai/agents";
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
import { agentPrompt, deepSeekReviewSystemPrompt, CRITICAL_REVIEWER_ID, PM_AGENT_ID, PM_AGENT_NAME, requireAgent, type AgentId } from "./agents/catalog";
import { buildProposal, proposalSourcesFromPackets } from "./proposal-builder";
import type { ProposalSource } from "@pm-studio/core";
import { formatAgentResults } from "./agent-result";
import { extractMemory } from "./tools/memory-extractor";
import { failedAgentPacket, normalizeAgentPacket, packetItemIds } from "./agent-packet";
import { normalizePmOutput, PM_DEFAULT_RATIONALE, PM_DEFAULT_TITLE } from "./pm-output";

setDefaultModelProvider(new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: providerBaseUrl("openai")
}));
const agentRunner = new Runner({ tracingDisabled: true });

const expertOutputSchema = agentPacketOutputSchema;
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
    id: `issue:${CRITICAL_REVIEWER_ID}:coverage:${index}`,
    kind: issue.kind,
    severity: issue.severity,
    targetRefs: [issue.id],
    detail: `专家报告的问题尚未获得批判评审核验：${issue.detail}`,
    evidenceIds: issue.evidenceIds,
    verification: "unresolved" as const
  }))];
  return { ...critic, issues };
}

export function normalizeReviewOutput(raw: string, evidenceIds: string[], targetRefs: string[]): AgentPacket {
  try {
    return normalizeAgentPacket(CRITICAL_REVIEWER_ID, JSON.parse(raw), evidenceIds, targetRefs);
  } catch (error) {
    return failedAgentPacket(CRITICAL_REVIEWER_ID, error instanceof Error ? error.message : String(error));
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

function localExpert(agentId: AgentId, agent: string, content: string, intent: TurnIntent, provider = "Demo", model = "demo-structured", retries = 0): ExpertResult {
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

async function openAiExpert(agentId: AgentId, agentName: string, input: string, content: string, intent: TurnIntent, evidenceIds: string[]): Promise<ExpertResult> {
  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  let failureReason = "UNKNOWN_EXPERT_FAILURE";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const agent = new Agent({
        name: agentName,
        model,
        outputType: expertOutputSchema,
        instructions: agentPrompt(agentId, evidenceIds)
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
  if (!process.env.DEEPSEEK_API_KEY) return localExpert(CRITICAL_REVIEWER_ID, "批判评审", content, intent, "Demo", "demo-review");
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
          { role: "system", content: deepSeekReviewSystemPrompt(evidenceIds) },
          { role: "user", content: `${input}\n\n[允许引用的专家 Item IDs]\n${targetRefs.join("\n")}` }
        ]
      });
      const reviewText = response.choices[0]?.message.content || "未发现新增风险";
      const result = normalizeReviewOutput(reviewText, evidenceIds, targetRefs);
      return {
        agentId: CRITICAL_REVIEWER_ID, agent: "批判评审",
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
  const fallback = { ...localExpert(CRITICAL_REVIEWER_ID, "批判评审", content, intent, "Demo (DeepSeek 降级)", "local-rules", 2), result: failedAgentPacket(CRITICAL_REVIEWER_ID, failureReason.slice(0, 500)) };
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
        name: PM_AGENT_NAME,
        model,
        outputType: pmSynthesisOutputSchema,
        instructions: agentPrompt(PM_AGENT_ID)
      });
      const result = await agentRunner.run(agent, `${input}\n\n[允许引用的提案候选]\n${JSON.stringify(sources)}`);
      const output = normalizePmOutput(result.finalOutput);
      const pmProposal = output.proposalItems.length
        ? { title: output.proposalTitle || PM_DEFAULT_TITLE, rationale: output.proposalRationale || PM_DEFAULT_RATIONALE, items: output.proposalItems }
        : undefined;
      return { answer: composePmAnswer(output.answer, output.reviewResponses, critic), status: "completed", provider: "OpenAI", model, retries: attempt, durationMs: Date.now() - started, proposal: buildProposal(sources, pmProposal), output };
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
    const agent = requireAgent(agentId);
    return [agentId, agent.name] as const;
  });

  const experts = demoMode
    ? expertSpecs.map(([agentId, name]) => localExpert(agentId, name, content, intent))
    : await Promise.all(expertSpecs.map(([agentId, name]) => openAiExpert(agentId, name, expertInput, content, intent, context.evidenceCatalog.map((item) => item.id))));
  const proposalCandidates = proposalSourcesFromPackets(experts.map((item) => item.result));
  const reviewInput = `${expertInput}\n\n[专家结构化结论]\n${formatAgentResults(experts)}`;
  const review = await deepSeekReview(reviewInput, content, intent, context.evidenceCatalog.map((item) => item.id), experts.flatMap((item) => packetItemIds(item.result)));
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
      id: id("step"), agent: PM_AGENT_NAME, provider: pm.provider, model: pm.model, status: pm.status,
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
