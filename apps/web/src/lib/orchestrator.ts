import "server-only";
import OpenAI from "openai";
import { Agent, OpenAIProvider, run as runAgent, setDefaultModelProvider } from "@openai/agents";
import { z } from "zod";
import { providerBaseUrl } from "./env";
import {
  assembleProductContext,
  classifyTurnIntent,
  planMemoryUpdates,
  type ProductBaseline,
  type StudioState,
  type TurnIntent,
  type WorkflowMode
} from "@pm-studio/core";
import { id, now } from "./ids";
import { agents, getAgent, tools } from "./agents/catalog";
import { createDemoExplorePlan, explorePlannerOutputSchema, type ExplorePlan, validateExplorePlan } from "./agents/explore";
import { runExploreLoop } from "./agents/explore-loop";

setDefaultModelProvider(new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: providerBaseUrl("openai")
}));

const expertOutputSchema = z.object({ summary: z.string(), findings: z.array(z.string()), openQuestions: z.array(z.string()) });
const proposalChangeSchema = z.object({ path: z.enum(["/requirements/-", "/decisions/-", "/risks/-", "/openQuestions/-", "/goals/-"]), after: z.string().trim().min(1).max(1000), selected: z.boolean().default(true) });
const pmProposalSchema = z.object({ title: z.string().trim().min(1).max(120), rationale: z.string().trim().min(1).max(600), changes: z.array(proposalChangeSchema).min(1).max(4) });
const pmOutputSchema = z.object({ answer: z.string(), openQuestions: z.array(z.string()), proposal: pmProposalSchema.optional() });

type ExpertResult = {
  agent: string;
  provider: string;
  model: string;
  summary: string;
  durationMs: number;
  retries: number;
};

type FinalAnswer = {
  answer: string;
  provider: string;
  model: string;
  retries: number;
  durationMs: number;
  proposal?: z.infer<typeof pmProposalSchema>;
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
  return { agent, provider, model, summary: summaries[agent], durationMs: 20 + agent.length * 7, retries };
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
      const result = await runAgent(agent, input);
      const output = expertOutputSchema.parse(result.finalOutput);
      const details = [...output.findings, ...output.openQuestions.map((item) => `待确认：${item}`)].slice(0, 4);
      return {
        agent: agentName,
        provider: "OpenAI",
        model,
        summary: [output.summary, ...details].join("；").slice(0, 900),
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

async function runStructuredWorkflow(demoMode: boolean, input: string, content: string, intent: TurnIntent) {
  const definitions = structuredAgentIds.map(requiredAgent);
  return demoMode
    ? definitions.map((agent) => localExpert(agent.name, content, intent))
    : Promise.all(definitions.map((agent) => openAiExpert(agent.name, agent.prompt, input, content, intent)));
}

async function planExploreDecision(input: string, content: string, round: number): Promise<{ plan: ExplorePlan; step: ExpertResult }> {
  const planner = requiredAgent("exploration-planner");
  const fallback = createDemoExplorePlan(round, content);
  if (!process.env.OPENAI_API_KEY) {
    return {
      plan: fallback,
      step: { agent: planner.name, provider: "Demo", model: "demo-react", summary: fallback.summary, durationMs: 12, retries: 0 }
    };
  }

  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  const capabilityList = [
    `可调用 Agent：${agents.filter((agent) => agent.id !== "exploration-planner" && agent.id !== "critical-reviewer" && agent.id !== "pm-synthesizer" && agent.modes.includes("explore")).map((agent) => `${agent.id}（${agent.name}）`).join("；") || "无"}`,
    `可调用 Tool：${tools.filter((tool) => tool.enabled).map((tool) => `${tool.id}（${tool.name}）`).join("；") || "无"}`
  ].join("\n");
  try {
    const agent = new Agent({
      name: planner.name,
      model,
      outputType: explorePlannerOutputSchema,
      instructions: `${planner.prompt}\n${capabilityList}\n返回 summary、text 和 calls。calls 为空时，text 必须是可直接给用户的最终答复；calls 非空时，逐项列出本轮必须执行的能力。只要判断需要 Agent 或 Tool，就必须把它写入 calls；不要在 summary 中说“需要调用”却把 calls 留空；不要调用未列出的能力。`
    });
    const result = await runAgent(agent, input);
    const output = explorePlannerOutputSchema.parse(result.finalOutput);
    const plan = validateExplorePlan(output);
    if (!plan) throw new Error("INVALID_EXPLORE_PLAN");
    const actionSummary = plan.calls.length
      ? `调用 ${plan.calls.map((call) => `${call.kind}:${call.id}`).join("、")}`
      : "直接输出";
    return {
      plan,
      step: { agent: planner.name, provider: "OpenAI", model, summary: `${actionSummary}。${plan.summary}`, durationMs: Date.now() - started, retries: 0 }
    };
  } catch {
    return {
      plan: fallback,
      step: { agent: planner.name, provider: "Demo (OpenAI 降级)", model: "demo-react", summary: `探索规划调用失败，已自动降级。${fallback.summary}`, durationMs: Date.now() - started, retries: 1 }
    };
  }
}

async function runExploreWorkflow(demoMode: boolean, expertInput: string, content: string, intent: TurnIntent) {
  const experts: ExpertResult[] = [];
  let latestPlanner: ExpertResult | undefined;
  let observedContext = "";
  const loop = await runExploreLoop({
    decide: async (round, observations) => {
      observedContext = observations.length
        ? `\n\n[探索观察]\n${observations.map((item, index) => `${index + 1}. ${item.summary}`).join("\n")}`
        : "";
      const planned = await planExploreDecision(`${expertInput}${observedContext}\n\n[探索轮次] ${round + 1}`, content, round);
      latestPlanner = planned.step;
      experts.push(planned.step);
      return planned.plan;
    },
    execute: async (action) => {
      if (action.kind === "tool") return { summary: `工具 ${action.id} 尚未接入执行器。` };
      const agent = requiredAgent(action.id);
      const input = `${expertInput}${observedContext}\n\n[本轮探索目标]\n${action.objective}`;
      const result = demoMode
        ? localExpert(agent.name, content, intent, "Demo", "demo-expert")
        : await openAiExpert(agent.name, `${agent.prompt}\n本轮探索目标：${action.objective}`, input, content, intent);
      experts.push(result);
      return { summary: result.summary };
    }
  });

  return {
    experts,
    directAnswer: loop.answer && latestPlanner
      ? { answer: loop.answer, provider: latestPlanner.provider, model: latestPlanner.model, retries: latestPlanner.retries, durationMs: latestPlanner.durationMs }
      : undefined
  };
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
      return {
        agent: "批判评审",
        provider: "DeepSeek",
        model,
        summary: (response.choices[0]?.message.content || "未发现新增风险").slice(0, 900),
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
  experts: ExpertResult[]
) {
  const fallback = localPmAnswer(content, intent, baseline, memoryPlan, experts);
  if (!process.env.OPENAI_API_KEY) return { answer: fallback, provider: "Demo", model: "local-pm", retries: 0, durationMs: 15, proposal: undefined };
  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const agent = new Agent({
        name: requiredAgent("pm-synthesizer").name,
        model,
        outputType: pmOutputSchema,
        instructions: requiredAgent("pm-synthesizer").prompt
      });
      const result = await runAgent(agent, input);
      const output = pmOutputSchema.parse(result.finalOutput);
      return { answer: output.answer, provider: "OpenAI", model, retries: attempt, durationMs: Date.now() - started, proposal: output.proposal };
    } catch {
      // Retry once, then keep the turn available with a deterministic answer.
    }
  }
  return { answer: fallback, provider: "Demo (OpenAI 降级)", model: "local-pm", retries: 2, durationMs: Date.now() - started, proposal: undefined };
}

export async function executeTurn(state: StudioState, projectId: string, content: string, actorName: string, workflowMode: WorkflowMode) {
  const project = state.projects.find((item) => item.id === projectId);
  const artifact = state.artifactVersions.filter((item) => item.projectId === projectId).sort((a, b) => b.version - a.version)[0];
  if (!project || !artifact) throw new Error("PROJECT_NOT_FOUND");

  const createdAt = now();
  const runId = id("run");
  const messageId = id("msg");
  const demoMode = !process.env.OPENAI_API_KEY;
  state.messages.push({ id: messageId, projectId, role: "user", author: actorName, content, citations: [], createdAt });
  const run: StudioState["runs"][number] = {
    id: runId, projectId, status: "running", costUsd: 0, durationMs: 0, demoMode, workflowMode, createdAt, steps: []
  };
  state.runs.unshift(run);
  const started = Date.now();
  const intent = classifyTurnIntent(content);
  const context = assembleProductContext(state, projectId, artifact.baseline, content);
  const memoryPlan = planMemoryUpdates(content, state.memories.filter((item) => item.projectId === projectId), messageId);
  const expertInput = `${context.text}\n\n[本轮用户输入]\n${content}`;
  let experts: ExpertResult[];
  let pm: FinalAnswer | undefined;
  if (workflowMode === "structured") {
    experts = await runStructuredWorkflow(demoMode, expertInput, content, intent);
  } else {
    const exploration = await runExploreWorkflow(demoMode, expertInput, content, intent);
    experts = exploration.experts;
    pm = exploration.directAnswer;
  }
  if (!pm) {
    const reviewInput = `${expertInput}\n\n[专家结论]\n${experts.map((item) => `${item.agent}：${item.summary}`).join("\n")}`;
    const review = await deepSeekReview(reviewInput, content, intent);
    experts.push(review);
    const pmInput = `${reviewInput}\n批判评审：${review.summary}\n\n[记忆整理结果]\n${JSON.stringify(memoryPlan)}\n\n[提案规则]\n只有专家结论支持的具体基线变更才能输出 proposal；不要把用户原话直接复制为提案。没有足够依据时不输出 proposal。`;
    pm = await synthesizePmAnswer(pmInput, content, intent, artifact.baseline, memoryPlan, experts);
  }
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

  const proposal = pm.proposal ? {
    id: id("prop"),
    projectId,
    title: pm.proposal.title,
    rationale: pm.proposal.rationale,
    baseVersion: project.baselineVersion,
    status: "pending" as const,
    changes: pm.proposal.changes,
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
      summary: item.summary, durationMs: item.durationMs, retries: item.retries, startedAt: createdAt
    })),
    {
      id: id("step"), agent: "PM 综合", provider: pm.provider, model: pm.model, status: "completed" as const,
      summary: `基于 v${project.baselineVersion} 基线、${context.counts.confirmedMemories} 条已确认记忆、${context.counts.candidateMemories} 条候选记忆和 ${context.counts.sources} 个来源生成统一答复。`,
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
