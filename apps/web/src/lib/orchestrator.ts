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
  proposalPathSchema,
  type StudioState,
  type TurnIntent,
  type WorkflowMode
} from "@pm-studio/core";
import { id, now } from "./ids";
import { agents, getAgent, tools } from "./agents/catalog";
import { canFinishExplorePlan, createDemoExplorePlan, explorePlannerOutputSchema, filterRepeatedExploreCalls, type ExploreActionHistory, type ExploreCall, type ExplorePlan, validateExplorePlan } from "./agents/explore";
import { runExploreLoop } from "./agents/explore-loop";

setDefaultModelProvider(new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: providerBaseUrl("openai")
}));

const expertOutputSchema = z.object({
  summary: z.string(),
  solved: z.array(z.string()).default([]),
  remaining: z.array(z.object({ key: z.string(), question: z.string(), suggestedCapabilityIds: z.array(z.string()).default([]) })).default([]),
  evidenceRefs: z.array(z.string()).default([])
});
const proposalChangeSchema = z.object({ path: proposalPathSchema, after: z.string().trim().min(1).max(1000), selected: z.boolean().default(true) });
const pmProposalItemSchema = z.object({ content: z.string().trim().min(1).max(1000), evidenceRefs: z.array(z.string()).default([]) });
const pmProposalSchema = z.object({
  title: z.string().trim().min(1).max(120),
  rationale: z.string().trim().min(1).max(600),
  audience: z.array(pmProposalItemSchema).default([]),
  goals: z.array(pmProposalItemSchema).default([]),
  metrics: z.array(pmProposalItemSchema).default([]),
  scope: z.array(pmProposalItemSchema).default([]),
  nonGoals: z.array(pmProposalItemSchema).default([]),
  requirements: z.array(pmProposalItemSchema).default([]),
  risks: z.array(pmProposalItemSchema).default([]),
  decisions: z.array(pmProposalItemSchema).default([]),
  openQuestions: z.array(pmProposalItemSchema).default([])
}).refine((proposal) => Object.values(proposal).some((value) => Array.isArray(value) && value.length > 0), { message: "proposal must contain at least one baseline change" });
export const pmOutputSchema = z.object({ answer: z.string(), openQuestions: z.array(z.string()), proposal: pmProposalSchema.optional() });
type NormalizedProposal = { title: string; rationale: string; changes: z.infer<typeof proposalChangeSchema>[] };
type PmProposalItem = z.infer<typeof pmProposalItemSchema>;
type PmProposalSection = "audience" | "goals" | "metrics" | "scope" | "nonGoals" | "requirements" | "risks" | "decisions" | "openQuestions";

type CapabilityExecution = {
  actionId?: string;
  capabilityId?: string;
  agent: string;
  provider: string;
  model: string;
  goal?: string;
  todoId?: string;
  basedOnGap?: { actionId: string; gapKey: string };
  route?: "primary" | "fallback" | "system";
  summary: string;
  solved?: string[];
  remaining?: Array<{ key: string; question: string; suggestedCapabilityIds: string[] }>;
  evidenceRefs?: string[];
  durationMs: number;
  retries: number;
};

type RuntimeWave = {
  index: number;
  source: "workflow" | "planner" | "system";
  summary: string;
  executions: CapabilityExecution[];
};

type FinalAnswer = {
  answer: string;
  provider: string;
  model: string;
  retries: number;
  durationMs: number;
  proposal?: NormalizedProposal;
};

function comparableProposalText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizePmProposal(input: z.input<typeof pmProposalSchema>, sourceText = ""): NormalizedProposal {
  const proposal = pmProposalSchema.parse(input);
  const sections: Array<[PmProposalSection, NormalizedProposal["changes"][number]["path"]]> = [
    ["audience", "/audience/-"], ["goals", "/goals/-"], ["metrics", "/metrics/-"], ["scope", "/scope/-"], ["nonGoals", "/nonGoals/-"], ["requirements", "/requirements/-"],
    ["risks", "/risks/-"], ["decisions", "/decisions/-"], ["openQuestions", "/openQuestions/-"]
  ];
  return {
    title: proposal.title,
    rationale: proposal.rationale,
    changes: sections
      .flatMap(([section, path]) => proposal[section].map((item) => ({ path, after: item.content, selected: true })))
      .filter((change) => !sourceText || comparableProposalText(change.after) !== comparableProposalText(sourceText))
      .slice(0, 8)
  };
}

const structuredAgentIds = ["requirements-analyst", "domain-analyst", "delivery-planner"] as const;

function requiredAgent(id: string) {
  const agent = getAgent(id);
  if (!agent) throw new Error(`AGENT_NOT_REGISTERED:${id}`);
  return agent;
}

const capabilityIdsByName: Record<string, string> = {
  "需求分析": "requirements-analyst", "领域分析": "domain-analyst", "交付规划": "delivery-planner",
  "批判评审": "critical-reviewer", "PM 综合": "pm-synthesizer", "探索规划": "exploration-planner"
};

function executionToAction(execution: CapabilityExecution, createdAt: string, todoId?: string) {
  const capabilityId = execution.capabilityId || capabilityIdsByName[execution.agent] || `legacy:${execution.agent}`;
  const solved = execution.solved?.length ? execution.solved : [execution.summary];
  return {
    id: execution.actionId || id("act"), capabilityId, todoId: todoId || execution.todoId, goal: execution.goal || execution.summary,
    basedOnGap: execution.basedOnGap,
    status: "succeeded" as const,
    execution: {
      route: execution.route || (execution.provider.startsWith("Demo") ? "fallback" : "primary") as "primary" | "fallback" | "system",
      provider: execution.provider, model: execution.model, durationMs: execution.durationMs, retries: execution.retries
    },
    result: {
      summary: execution.summary,
      solved,
      remaining: execution.remaining || [],
      evidenceRefs: execution.evidenceRefs || []
    },
    startedAt: createdAt,
    completedAt: createdAt
  };
}

function executionWave(index: number, source: "workflow" | "planner" | "system", summary: string, executions: CapabilityExecution[], createdAt: string) {
  return { id: id("wave"), index, source, summary, actions: executions.map((execution) => executionToAction(execution, createdAt)), createdAt, completedAt: createdAt };
}

function localExpert(agent: string, content: string, intent: TurnIntent, provider = "Demo", model = "demo-structured", retries = 0): CapabilityExecution {
  const focus = content.length > 72 ? `${content.slice(0, 72)}...` : content;
  const summaries: Record<string, string> = {
    "需求分析": `识别为“${intent}”意图；核心表述是“${focus}”。已区分新增事实、操作请求和待确认内容。`,
    "领域分析": "结合正式基线检查了用户、流程、数据、运营、合规和审批边界，未把候选信息当作已确认事实。",
    "交付规划": intent === "planning"
      ? "建议按 Outcome → Capability → Epic → WorkItem → AcceptanceCriterion 组织，并先补齐目标、依赖和验收证据。"
      : "本轮先更新产品理解；只有可执行的新事实进入候选提案，纯提问和重复表述不创建变更。",
    "批判评审": "已检查事实冲突、无来源推断、重复记忆和越权修改基线风险。"
  };
  return { agent, provider, model, summary: summaries[agent], solved: [summaries[agent]], remaining: [], evidenceRefs: [], durationMs: 20 + agent.length * 7, retries };
}

async function openAiExpert(agentName: string, instructions: string, input: string, content: string, intent: TurnIntent): Promise<CapabilityExecution> {
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
      const details = [...output.solved, ...output.remaining.map((item) => `待确认：${item.question}`)].slice(0, 4);
      return {
        agent: agentName,
        provider: "OpenAI",
        model,
        summary: [output.summary, ...details].join("；").slice(0, 900),
        solved: output.solved,
        remaining: output.remaining,
        evidenceRefs: output.evidenceRefs,
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

async function planExploreDecision(input: string, content: string, round: number, todos: Array<{ id: string; title: string; status: "open" | "done" }>, history: ExploreActionHistory[] = []): Promise<{ plan: ExplorePlan; step: CapabilityExecution }> {
  const planner = requiredAgent("exploration-planner");
  const fallback = createDemoExplorePlan(round, content);
  if (!process.env.OPENAI_API_KEY) {
    return {
      plan: fallback,
      step: { capabilityId: "exploration-planner", agent: planner.name, provider: "Demo", model: "demo-react", goal: "生成探索 Todo 和下一步调用", summary: fallback.summary, solved: [fallback.summary], remaining: [], evidenceRefs: [], durationMs: 12, retries: 0 }
    };
  }

  const model = process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra";
  const started = Date.now();
  const capabilityList = [
    `可调用 Agent：${agents.filter((agent) => agent.id !== "exploration-planner" && agent.id !== "critical-reviewer" && agent.id !== "pm-synthesizer" && agent.modes.includes("explore")).map((agent) => `${agent.id}（${agent.name}）`).join("；") || "无"}`,
    `可调用 Tool：${tools.filter((tool) => tool.enabled).map((tool) => `${tool.id}（${tool.name}）`).join("；") || "无"}`,
    `当前 Todo：${todos.map((todo) => `${todo.id}[${todo.status}] ${todo.title}`).join("；") || "无"}`
  ].join("\n");
  try {
    const agent = new Agent({
      name: planner.name,
      model,
      outputType: explorePlannerOutputSchema,
      instructions: `${planner.prompt}\n${capabilityList}\n返回 summary、text、newTodos、todoUpdates 和 calls。calls 为空时，text 只作为阶段性结论，最终由 PM 综合；calls 非空时，逐项列出本轮必须执行的能力。重复调用同一能力必须基于上一轮 Result.remaining 中真实存在的 gap，并填写 basedOnGap.actionId 和 basedOnGap.gapKey。不要只因为摘要相似就重复调用；不要调用未列出的能力。`
    });
    const result = await runAgent(agent, input);
    const output = explorePlannerOutputSchema.parse(result.finalOutput);
    const validated = validateExplorePlan(output);
    if (!validated) throw new Error("INVALID_EXPLORE_PLAN");
    const plan = filterRepeatedExploreCalls(validated, history);
    if (validated.calls.length && !plan.calls.length) {
      plan.text = "已有分析结果覆盖本轮目标，进入 PM 综合。";
      plan.todoUpdates = [...plan.todoUpdates, ...todos.filter((todo) => todo.status === "open").map((todo) => ({ todoId: todo.id, status: "done" as const }))];
    }
    if (!plan.calls.length && !canFinishExplorePlan(plan, todos)) throw new Error("EXPLORE_PLAN_HAS_OPEN_TODOS");
    const actionSummary = plan.calls.length
      ? `调用 ${plan.calls.map((call) => `${call.kind}:${call.id}`).join("、")}`
      : "直接输出";
    return {
      plan,
      step: { capabilityId: "exploration-planner", agent: planner.name, provider: "OpenAI", model, goal: "生成探索 Todo 和下一步调用", summary: `${actionSummary}。${plan.summary}`, solved: [plan.summary], remaining: [], evidenceRefs: [], durationMs: Date.now() - started, retries: 0 }
    };
  } catch {
    return {
      plan: fallback,
      step: { capabilityId: "exploration-planner", agent: planner.name, provider: "Demo (OpenAI 降级)", model: "demo-react", goal: "生成探索 Todo 和下一步调用", summary: `探索规划调用失败，已自动降级。${fallback.summary}`, solved: [fallback.summary], remaining: [], evidenceRefs: [], durationMs: Date.now() - started, retries: 1 }
    };
  }
}

async function runExploreWorkflow(demoMode: boolean, expertInput: string, content: string, intent: TurnIntent) {
  const experts: CapabilityExecution[] = [];
  const todos: Array<{ id: string; title: string; status: "open" | "done" }> = [];
  const waves: RuntimeWave[] = [];
  let latestPlanner: CapabilityExecution | undefined;
  let observedContext = "";
  let currentWave: RuntimeWave | undefined;
  const loop = await runExploreLoop({
    decide: async (round, observations) => {
      observedContext = observations.length
        ? `\n\n[探索结果]\n${observations.map((item, index) => `${index + 1}. Action ${item.action.kind}:${item.action.id}（Todo: ${item.action.todoRef}）\n目标：${item.action.objective}\nResult：${JSON.stringify(item.result)}`).join("\n")}`
        : "";
      const todoContext = `\n\n[探索 Todo]\n${todos.map((todo) => `${todo.id}[${todo.status}] ${todo.title}`).join("\n") || "无"}`;
      const history: ExploreActionHistory[] = observations.map((observation) => ({ action: observation.action, actionId: observation.actionId, remainingGapKeys: observation.result.remaining.map((gap) => gap.key) }));
      const planned = await planExploreDecision(`${expertInput}${todoContext}${observedContext}\n\n[探索轮次] ${round + 1}`, content, round, todos, history);
      for (const todo of planned.plan.newTodos) {
        if (!todos.some((item) => item.id === todo.key)) todos.push({ id: todo.key, title: todo.title, status: "open" });
      }
      for (const update of planned.plan.todoUpdates) {
        const todo = todos.find((item) => item.id === update.todoId);
        if (todo) todo.status = update.status;
      }
      latestPlanner = planned.step;
      experts.push(planned.step);
      currentWave = { index: round + 1, source: "planner", summary: planned.plan.summary, executions: [planned.step] };
      waves.push(currentWave);
      return planned.plan;
    },
    execute: async (action) => {
      if (action.kind === "tool") {
        const actionId = id("act");
        const result = { summary: `工具 ${action.id} 尚未接入执行器。`, solved: [], remaining: [{ key: `${action.id}-implementation`, question: "工具实现", suggestedCapabilityIds: [] }], evidenceRefs: [] };
        currentWave?.executions.push({ actionId, capabilityId: action.id, agent: action.id, provider: "System", model: "unavailable", goal: action.objective, basedOnGap: action.basedOnGap, route: "system", ...result, durationMs: 0, retries: 0 });
        return { actionId, ...result };
      }
      const agent = requiredAgent(action.id);
      const input = `${expertInput}${observedContext}\n\n[本轮探索目标]\n${action.objective}`;
      const result = demoMode
        ? localExpert(agent.name, content, intent, "Demo", "demo-expert")
        : await openAiExpert(agent.name, `${agent.prompt}\n本轮探索目标：${action.objective}`, input, content, intent);
      const actionId = id("act");
      result.actionId = actionId;
      result.capabilityId = action.id;
      result.goal = action.objective;
      result.basedOnGap = action.basedOnGap;
      result.todoId = todos.find((todo) => todo.id === action.todoRef)?.id;
      experts.push(result);
      currentWave?.executions.push(result);
      return { actionId, summary: result.summary, solved: result.solved || [], remaining: result.remaining || [], evidenceRefs: result.evidenceRefs || [] };
    }
  });

  return {
    experts,
    todos,
    waves,
    directAnswer: loop.answer && latestPlanner
      ? { answer: loop.answer, provider: latestPlanner.provider, model: latestPlanner.model, retries: latestPlanner.retries, durationMs: latestPlanner.durationMs }
      : undefined
  };
}

async function deepSeekReview(input: string, content: string, intent: TurnIntent): Promise<CapabilityExecution> {
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

function localPmProposal(memoryPlan: ReturnType<typeof planMemoryUpdates>): NormalizedProposal | undefined {
  const grouped: { title: string; rationale: string } & Record<PmProposalSection, PmProposalItem[]> = {
    title: "候选产品基线变更",
    rationale: "本轮 PM 综合整理出可供人工审批的候选变更。",
    audience: [], goals: [], metrics: [], scope: [], nonGoals: [], requirements: [], risks: [], decisions: [], openQuestions: []
  };
  const sectionByType: Record<string, PmProposalSection> = {
    fact: "requirements", constraint: "requirements", decision: "decisions", risk: "risks", open_question: "openQuestions"
  };
  for (const draft of memoryPlan.creates) {
    const section = sectionByType[draft.type];
    if (section) grouped[section].push({ content: draft.content, evidenceRefs: [] });
  }
  return Object.entries(grouped).some(([key, value]) => ["audience", "goals", "metrics", "scope", "nonGoals", "requirements", "risks", "decisions", "openQuestions"].includes(key) && value.length > 0)
    ? normalizePmProposal(pmProposalSchema.parse(grouped))
    : undefined;
}

function localPmAnswer(content: string, intent: TurnIntent, baseline: ProductBaseline, memoryPlan: ReturnType<typeof planMemoryUpdates>, experts: CapabilityExecution[]) {
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
  experts: CapabilityExecution[]
) {
  const fallback = localPmAnswer(content, intent, baseline, memoryPlan, experts);
  if (!process.env.OPENAI_API_KEY) return { answer: fallback, provider: "Demo", model: "local-pm", retries: 0, durationMs: 15, proposal: localPmProposal(memoryPlan) };
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
      const proposal = output.proposal ? normalizePmProposal(output.proposal, content) : undefined;
      return { answer: output.answer, provider: "OpenAI", model, retries: attempt, durationMs: Date.now() - started, proposal: proposal?.changes.length ? proposal : undefined };
    } catch {
      // Retry once, then keep the turn available with a deterministic answer.
    }
  }
  return { answer: fallback, provider: "Demo (OpenAI 降级)", model: "local-pm", retries: 2, durationMs: Date.now() - started, proposal: localPmProposal(memoryPlan) };
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
    id: runId, projectId, userMessageId: messageId, workflowMode, status: "running", todos: [], waves: [], costUsd: 0, durationMs: 0, createdAt
  };
  state.runs.unshift(run);
  const started = Date.now();
  const intent = classifyTurnIntent(content);
  const context = assembleProductContext(state, projectId, artifact.baseline, content);
  const memoryPlan = planMemoryUpdates(content, state.memories.filter((item) => item.projectId === projectId), messageId);
  const expertInput = `${context.text}\n\n[本轮用户输入]\n${content}`;
  let experts: CapabilityExecution[];
  let runtimeWaves: RuntimeWave[] = [];
  let exploreTodos: Array<{ id: string; title: string; status: "open" | "done" }> = [];
  let plannerDraft = "";
  if (workflowMode === "structured") {
    experts = await runStructuredWorkflow(demoMode, expertInput, content, intent);
    runtimeWaves.push({ index: 1, source: "workflow", summary: "并行完成需求、领域和交付分析", executions: [...experts] });
  } else {
    const exploration = await runExploreWorkflow(demoMode, expertInput, content, intent);
    experts = exploration.experts;
    runtimeWaves = exploration.waves;
    exploreTodos = exploration.todos;
    plannerDraft = exploration.directAnswer?.answer || "";
  }
  const expertContext = JSON.stringify(experts.map((item) => ({
    actionId: item.actionId,
    capabilityId: item.capabilityId,
    agent: item.agent,
    todoId: item.todoId,
    goal: item.goal,
    basedOnGap: item.basedOnGap,
    summary: item.summary,
    solved: item.solved || [],
    remaining: item.remaining || [],
    evidenceRefs: item.evidenceRefs || []
  })), null, 2);
  const reviewInput = `${expertInput}\n\n[专家与探索结论]\n${expertContext}${plannerDraft ? `\n\n[Planner 阶段性答复]\n${plannerDraft}` : ""}`;
  const review = await deepSeekReview(reviewInput, content, intent);
  experts.push(review);
  runtimeWaves.push({ index: runtimeWaves.length + 1, source: "workflow", summary: "检查事实冲突、证据缺口和越权风险", executions: [review] });
  const pmInput = `${reviewInput}\n批判评审：${review.summary}\n\n[记忆整理结果]\n${JSON.stringify(memoryPlan)}\n\n[PM 提案规则]\n你是唯一的最终综合节点。结合用户问题、正式基线、记忆和全部专家 Result 输出 answer、openQuestions 和 proposal。proposal 必须使用 audience、goals、metrics、scope、nonGoals、requirements、risks、decisions、openQuestions 分组数组；每项写清可插入的具体内容和 evidenceRefs。没有足够证据时 proposal 省略；不得把用户问题原文直接当作变更。`;
  const pm = await synthesizePmAnswer(pmInput, content, intent, artifact.baseline, memoryPlan, experts);
  runtimeWaves.push({ index: runtimeWaves.length + 1, source: "workflow", summary: "PM 综合全部上下文并生成分组候选提案", executions: [{ capabilityId: "pm-synthesizer", agent: "PM 综合", provider: pm.provider, model: pm.model, goal: "基于全部分析结果回答用户并输出候选提案", summary: "已完成统一 PM 综合", solved: [pm.answer], remaining: [], evidenceRefs: [], durationMs: pm.durationMs, retries: pm.retries }] });
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

  runtimeWaves.push({
    index: runtimeWaves.length + 1,
    source: "system",
    summary: "整理候选记忆并生成候选提案",
    executions: [
      { capabilityId: "memory-projector", agent: "记忆整理", provider: "Local", model: "memory-policy-v2", route: "system", goal: "根据本轮消息整理候选记忆", summary: `新增 ${memoryPlan.creates.length} 条候选，合并 ${memoryPlan.merges.length} 条重复来源，命中 ${memoryPlan.blockingConflictIds.length} 项阻断冲突。`, solved: [], remaining: [], evidenceRefs: [], durationMs: 8, retries: 0 },
      { capabilityId: "proposal-projector", agent: "提案整理", provider: "Local", model: "proposal-policy-v1", route: "system", goal: "将 PM 输出的候选变更写入待审批提案", summary: proposal ? `生成 ${proposal.changes.length} 项待审批变更。` : "本轮没有可审批的基线变更。", solved: [], remaining: [], evidenceRefs: [], durationMs: 1, retries: 0 }
    ]
  });
  run.todos = exploreTodos;
  run.waves = runtimeWaves.map((wave) => executionWave(wave.index, wave.source, wave.summary, wave.executions, createdAt));
  project.openQuestions = artifact.baseline.openQuestions.length + state.memories.filter((item) => item.projectId === projectId && item.status === "candidate" && ["open_question", "conflict"].includes(item.type)).length;
  project.updatedAt = answerCreatedAt;
  run.status = "completed";
  run.durationMs = Date.now() - started;
  run.costUsd = demoMode ? 0 : Number(process.env.PM_STUDIO_ESTIMATED_RUN_COST_USD || 0.02);
  run.completedAt = now();
  return { run, proposal };
}
