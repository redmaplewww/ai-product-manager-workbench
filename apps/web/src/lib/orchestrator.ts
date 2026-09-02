import "server-only";
import OpenAI from "openai";
import { Agent, OpenAIProvider, Runner, setDefaultModelProvider } from "@openai/agents";
import { z } from "zod";
import { providerBaseUrl } from "./env";
import {
  assembleProductContext,
  agentResultSchema,
  classifyTurnIntent,
  planMemoryUpdates,
  planProposalChanges,
  type ProductBaseline,
  type AgentResult,
  type StudioState,
  type TurnIntent
} from "@pm-studio/core";
import { id, now } from "./ids";
import { getAgent } from "./agents/catalog";
import { buildProposal, supportedProposalCategories, type PmProposal, type ProposalSource } from "./proposal-builder";
import { formatAgentResults } from "./agent-result";
import { extractMemory } from "./tools/memory-extractor";

setDefaultModelProvider(new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: providerBaseUrl("openai")
}));
const agentRunner = new Runner({ tracingDisabled: true });

const expertOutputSchema = agentResultSchema;
const proposalItemSchema = z.object({ sourceIndex: z.number().int().nonnegative(), category: z.enum(supportedProposalCategories), content: z.string().trim().min(1).max(1000), selected: z.boolean().default(true) });
const legacyProposalChangeSchema = z.object({ path: z.string(), after: z.string(), selected: z.boolean().default(true) });
const legacyProposalSchema = z.object({ title: z.string(), rationale: z.string(), changes: z.array(legacyProposalChangeSchema).max(8) });
const pmOutputSchema = z.object({ answer: z.string(), proposalTitle: z.string().trim().min(1).max(120).nullable(), proposalRationale: z.string().trim().min(1).max(600).nullable(), proposal: z.union([z.array(proposalItemSchema).max(8), legacyProposalSchema]).nullable() });

type PmOutput = z.infer<typeof pmOutputSchema>;
type NormalizedPmOutput = Omit<PmOutput, "proposal"> & { proposal: Array<z.infer<typeof proposalItemSchema>> | null };

function comparableProposalText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizePmOutput(value: unknown, sources: ProposalSource[]): NormalizedPmOutput {
  const input = typeof value === "object" && value !== null
    ? { ...(value as Record<string, unknown>), proposalTitle: (value as Record<string, unknown>).proposalTitle ?? null, proposalRationale: (value as Record<string, unknown>).proposalRationale ?? null, proposal: (value as Record<string, unknown>).proposal ?? null }
    : value;
  const output = pmOutputSchema.parse(input);
  const { proposal, ...rest } = output;
  if (!proposal) return { ...rest, proposal: null };
  if (Array.isArray(proposal)) return { ...rest, proposal };

  const items = proposal.changes.flatMap((change) => {
    const category = change.path.split("/")[1];
    if (!supportedProposalCategories.includes(category as (typeof supportedProposalCategories)[number])) return [];
    const sourceIndex = sources.findIndex((source) => comparableProposalText(source.content) === comparableProposalText(change.after));
    if (sourceIndex < 0) return [];
    return [{ sourceIndex, category: category as (typeof supportedProposalCategories)[number], content: change.after, selected: change.selected }];
  });

  return {
    ...rest,
    proposalTitle: output.proposalTitle || proposal.title,
    proposalRationale: output.proposalRationale || proposal.rationale,
    proposal: items
  };
}

export function normalizeReviewOutput(raw: string): AgentResult {
  const text = raw.trim() || "未发现新增风险";
  try {
    const parsed = agentResultSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    // Providers may ignore the JSON-only instruction and return Markdown.
  }

  const findings: string[] = [];
  const openQuestions: string[] = [];
  const evidenceRefs: string[] = [];
  let section: "findings" | "openQuestions" | "evidenceRefs" | undefined;
  for (const line of text.split(/\r?\n/u)) {
    const heading = line.replace(/^#+\s*/u, "").replace(/[：:]$/u, "").trim();
    if (/矛盾|问题|风险/u.test(heading)) { section = "findings"; continue; }
    if (/澄清|开放问题|待确认/u.test(heading)) { section = "openQuestions"; continue; }
    if (/证据|来源/u.test(heading)) { section = "evidenceRefs"; continue; }
    if (/假设|建议/u.test(heading)) { section = undefined; continue; }
    const item = line.replace(/^\s*[-*]\s*/u, "").trim();
    if (!item || item === line.trim() || !section) continue;
    if (section === "findings") findings.push(item);
    if (section === "openQuestions") openQuestions.push(item);
    if (section === "evidenceRefs") evidenceRefs.push(item);
  }
  return {
    summary: (findings[0] || "批判评审已完成，未形成可直接写入基线的结论。").slice(0, 900),
    findings: findings.slice(0, 8),
    openQuestions: openQuestions.slice(0, 8),
    evidenceRefs: evidenceRefs.slice(0, 8)
  };
}

type ExpertResult = {
  agent: string;
  provider: string;
  model: string;
  summary: string;
  result: AgentResult;
  durationMs: number;
  retries: number;
};

const structuredAgentIds = ["requirements-analyst", "domain-analyst", "delivery-planner"] as const;

function requiredAgent(id: string) {
  const agent = getAgent(id);
  if (!agent) throw new Error(`AGENT_NOT_REGISTERED:${id}`);
  return agent;
}

function localExpert(agent: string, content: string, intent: TurnIntent, provider = "Demo", model = "demo-structured", retries = 0): ExpertResult {
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
  return { agent, provider, model, summary, result: { summary, findings: [], openQuestions: [], evidenceRefs: [] }, durationMs: 20 + agent.length * 7, retries };
}

async function openAiExpert(agentName: string, instructions: string, input: string, content: string, intent: TurnIntent): Promise<ExpertResult> {
  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const agent = new Agent({
        name: agentName,
        model,
        outputType: expertOutputSchema,
        instructions: `${instructions}\n只返回结构化结论，不输出思维链。明确区分正式基线、已确认记忆、候选记忆和不可信外部资料。`
      });
      const result = await agentRunner.run(agent, input);
      const output = expertOutputSchema.parse(result.finalOutput);
      const details = [...output.findings, ...output.openQuestions.map((item) => `待确认：${item}`)].slice(0, 4);
      return {
        agent: agentName,
        provider: "OpenAI",
        model,
        summary: [output.summary, ...details].join("；").slice(0, 900),
        result: output,
        durationMs: Date.now() - started,
        retries: attempt
      };
    } catch {
      // One bounded retry is recorded in the transparent run trace.
    }
  }
  const fallback = localExpert(agentName, content, intent, "Demo (OpenAI 降级)", "local-rules", 2);
  fallback.durationMs = Date.now() - started;
  fallback.summary = `OpenAI 专家调用失败，已自动降级。${fallback.summary}`;
  return fallback;
}

async function deepSeekReview(input: string, content: string, intent: TurnIntent): Promise<ExpertResult> {
  if (!process.env.DEEPSEEK_API_KEY) return localExpert("批判评审", content, intent, "Demo", "demo-review");
  const model = process.env.DEEPSEEK_REVIEW_MODEL || "deepseek-v4-pro";
  const started = Date.now();
  const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: providerBaseUrl("deepseek") });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: requiredAgent("critical-reviewer").prompt },
          { role: "user", content: input }
        ]
      });
      const reviewText = response.choices[0]?.message.content || "未发现新增风险";
      const result = normalizeReviewOutput(reviewText);
      return {
        agent: "批判评审",
        provider: "DeepSeek",
        model,
        summary: [result.summary, ...result.findings.slice(1, 4), ...result.openQuestions.slice(0, 2).map((item) => `待确认：${item}`)].join("；").slice(0, 900),
        result,
        durationMs: Date.now() - started,
        retries: attempt
      };
    } catch {
      // One bounded retry keeps transient provider failures recoverable.
    }
  }
  const fallback = localExpert("批判评审", content, intent, "Demo (DeepSeek 降级)", "local-rules", 2);
  fallback.durationMs = Date.now() - started;
  fallback.summary = `DeepSeek 评审调用失败，已自动降级。${fallback.summary}`;
  return fallback;
}

function localPmAnswer(content: string, intent: TurnIntent, baseline: ProductBaseline, memoryPlan: ReturnType<typeof planMemoryUpdates>, experts: ExpertResult[]) {
  const conflict = memoryPlan.creates.find((item) => item.type === "conflict");
  if (memoryPlan.blockingConflictIds.length) {
    return `我发现这轮内容涉及未解决冲突，因此没有覆盖旧记忆，也没有生成任何基线变更。\n\n${conflict?.content || "该冲突已存在，本轮消息已合并为新的来源。"}\n\n请在记忆面板中选择保留原结论，或用纠正功能确认新说法。冲突解决前，同轮其他候选内容也不会直接驱动正式规划。`;
  }
  if (intent === "question") {
    return `基于当前已批准产品基线，我的回答是：${baseline.summary}\n\n当前必须遵守的边界包括：${baseline.requirements.slice(0, 3).join("；")}。正式决策是：${baseline.decisions.slice(0, 3).join("；")}。\n\n本轮是问答，不会因此创建基线变更；如果你的问题实际包含一项新决定，请明确说“确定采用……”或“必须……”。`;
  }
  if (intent === "planning") {
    return `我会把“${content}”作为规划请求处理，而不是直接当成新的产品事实。\n\n建议拆分：\nOutcome：明确期望结果和度量指标\nCapability：形成支撑该结果的稳定能力\nEpic：按可独立评审的产品增量组织\nWorkItem：补齐类型、优先级、依赖、负责人角色、估算和风险\nAcceptanceCriterion：每项工作至少包含一个可重复验证的通过条件\n\n${experts.find((item) => item.agent === "批判评审")?.summary || ""}`;
  }
  if (!memoryPlan.creates.length && memoryPlan.merges.length) {
    return "这条表述与已有产品记忆一致。我已把本轮消息补充为该记忆的新来源，没有创建重复记忆或重复提案。\n\n当前仍以已批准基线为准；这次重复确认会保留在审计链路中。";
  }
  const created = memoryPlan.creates.map((item) => `${item.type}：${item.content}`).join("\n");
  return `我已将这轮内容拆成可核对的候选信息：\n${created}\n\n这些内容只进入候选记忆和待审批差异，不会直接改变正式基线。规划时会继续以已批准决策和约束为最高优先级，并把候选记忆标记为低权重。`;
}

async function synthesizePmAnswer(
  input: string,
  content: string,
  intent: TurnIntent,
  baseline: ProductBaseline,
  memoryPlan: ReturnType<typeof planMemoryUpdates>,
  experts: ExpertResult[],
  sources: ProposalSource[]
): Promise<{
  answer: string;
  provider: string;
  model: string;
  retries: number;
  durationMs: number;
  proposal: ReturnType<typeof buildProposal>;
  output: unknown;
  fallbackReason?: string;
}> {
  const fallback = localPmAnswer(content, intent, baseline, memoryPlan, experts);
  if (!process.env.OPENAI_API_KEY) return { answer: fallback, provider: "Demo", model: "local-pm", retries: 0, durationMs: 15, proposal: buildProposal(sources), output: { answer: fallback } };
  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  let fallbackReason = "未知错误";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const agent = new Agent({
        name: requiredAgent("pm-synthesizer").name,
        model,
        outputType: pmOutputSchema,
        instructions: `${requiredAgent("pm-synthesizer").prompt}\nproposal 只能引用给定的候选变更。每个数组项必须填写 sourceIndex，选择一个与基线一致的 category，并把内容重新组织为产品条目；不要新增候选数组之外的功能、范围或要求。`
      });
      const result = await agentRunner.run(agent, `${input}\n\n[允许引用的候选事实]\n${JSON.stringify(sources.map((source, sourceIndex) => ({ sourceIndex, ...source })))} `);
      const output = normalizePmOutput(result.finalOutput, sources);
      const pmProposal = output.proposal?.length
        ? { title: output.proposalTitle || "本轮产品基线候选变更", rationale: output.proposalRationale || "PM 已将本轮内容整理为候选变更，审批通过后才会写入正式基线。", items: output.proposal }
        : undefined;
      return { answer: output.answer, provider: "OpenAI", model, retries: attempt, durationMs: Date.now() - started, proposal: buildProposal(sources, pmProposal as PmProposal), output };
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error);
      // Retry once, then keep the turn available with a deterministic answer.
    }
  }
  return { answer: fallback, provider: "Demo (OpenAI 降级)", model: "local-pm", retries: 2, durationMs: Date.now() - started, proposal: null, fallbackReason: fallbackReason.slice(0, 300), output: { answer: fallback, fallbackReason: fallbackReason.slice(0, 300) } };
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
  const context = assembleProductContext(state, projectId, artifact.baseline, content);
  const memoryPlan = extractMemory({ content, memories: state.memories.filter((item) => item.projectId === projectId), sourceMessageId: messageId });
  const plannedChanges = planProposalChanges(memoryPlan, intent);
  const proposalSources = plannedChanges.map(({ after }) => ({ content: after }));
  const expertInput = `${context.text}\n\n[本轮用户输入]\n${content}`;
  const expertSpecs = structuredAgentIds.map((agentId) => {
    const agent = requiredAgent(agentId);
    return [agent.name, agent.prompt] as const;
  });

  const experts = demoMode
    ? expertSpecs.map(([name]) => localExpert(name, content, intent))
    : await Promise.all(expertSpecs.map(([name, instructions]) => openAiExpert(name, instructions, expertInput, content, intent)));
  const reviewInput = `${expertInput}\n\n[专家结构化结论]\n${formatAgentResults(experts)}`;
  const review = await deepSeekReview(reviewInput, content, intent);
  experts.push(review);

  const pmInput = `${reviewInput}\n批判评审：${review.summary}\n\n[记忆整理结果]\n${JSON.stringify(memoryPlan)}\n\n[提案候选门槛]\n${JSON.stringify({ willCreateProposal: proposalSources.length > 0, sourceCount: proposalSources.length })}`;
  const pm = await synthesizePmAnswer(pmInput, content, intent, artifact.baseline, memoryPlan, experts, proposalSources);
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
      id: id("step"), agent: item.agent, provider: item.provider, model: item.model, status: "completed" as const,
      summary: item.summary, result: item.result, durationMs: item.durationMs, retries: item.retries, startedAt: createdAt
    })),
    {
      id: id("step"), agent: "PM 综合", provider: pm.provider, model: pm.model, status: "completed" as const,
      summary: `${pm.fallbackReason ? `PM 调用失败：${pm.fallbackReason}。` : ""}${pm.answer}`.slice(0, 900), output: pm.output,
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
