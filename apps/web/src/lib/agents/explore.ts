import { z } from "zod";
import { getAgent, getExecutableTool } from "./catalog";

const basedOnGapSchema = z.object({ actionId: z.string().min(1), gapKey: z.string().min(1) });
const agentCallSchema = z.object({ todoRef: z.string().min(1), kind: z.literal("agent"), id: z.enum(["requirements-analyst", "domain-analyst", "delivery-planner"]), objective: z.string().min(1), basedOnGap: basedOnGapSchema.optional() });
const toolCallSchema = z.object({ todoRef: z.string().min(1), kind: z.literal("tool"), id: z.enum(["source-search"]), objective: z.string().min(1), basedOnGap: basedOnGapSchema.optional() });

export const exploreCallSchema = z.discriminatedUnion("kind", [agentCallSchema, toolCallSchema]);
const todoUpdateSchema = z.object({ todoId: z.string().min(1), status: z.literal("done") });
export const explorePlannerOutputSchema = z.object({
  summary: z.string().min(1),
  text: z.string(),
  newTodos: z.array(z.object({ key: z.string().min(1), title: z.string().min(1) })).max(3).default([]),
  todoUpdates: z.array(todoUpdateSchema).max(3).default([]),
  calls: z.array(exploreCallSchema).max(3)
});
export type ExploreCall = z.infer<typeof exploreCallSchema>;
export type ExplorePlan = z.infer<typeof explorePlannerOutputSchema>;

function capabilityTodoKey(call: ExploreCall) {
  return `${call.kind}:${call.id}:${call.todoRef}`;
}

export type ExploreActionHistory = { action: ExploreCall; actionId: string; remainingGapKeys: string[] };

export function filterRepeatedExploreCalls(plan: ExplorePlan, history: ExploreActionHistory[]): ExplorePlan {
  const seen = new Set(history.map((item) => capabilityTodoKey(item.action)));
  const repeatedGaps = new Set(history.map((item) => item.action.basedOnGap ? `${item.action.basedOnGap.actionId}:${item.action.basedOnGap.gapKey}` : ""));
  const roundSeen = new Set<string>();
  const calls = plan.calls.filter((call) => {
    const key = capabilityTodoKey(call);
    if (!seen.has(key) && !roundSeen.has(key)) {
      roundSeen.add(key);
      return true;
    }
    if (!call.basedOnGap) return false;
    if (repeatedGaps.has(`${call.basedOnGap.actionId}:${call.basedOnGap.gapKey}`)) return false;
    const source = history.find((item) => item.actionId === call.basedOnGap?.actionId);
    if (!source?.remainingGapKeys.includes(call.basedOnGap.gapKey)) return false;
    roundSeen.add(key);
    return true;
  });
  return { ...plan, calls };
}

export function canRunExploreRound(round: number) {
  return round < 3;
}

export function canFinishExplorePlan(plan: ExplorePlan, todos: Array<{ id: string; title?: string; status: "open" | "done" }>) {
  const completed = new Set(plan.todoUpdates.map((update) => update.todoId));
  return [...todos, ...plan.newTodos.map((todo) => ({ id: todo.key, status: "open" as const }))]
    .every((todo) => todo.status === "done" || completed.has(todo.id));
}

export function createDemoExplorePlan(round: number, content: string): ExplorePlan {
  if (round >= 2) {
    return {
      summary: "现有探索结论已足以形成答复。",
      text: `我已完成对“${content}”的探索性分析，并将关键结论保留为候选信息，等待你确认后再进入正式产品基线。`,
      newTodos: [],
      todoUpdates: [{ todoId: "scope", status: "done" }],
      calls: []
    };
  }

  const id = round === 0 ? "requirements-analyst" : "domain-analyst";
  return {
    summary: round === 0 ? "先建立问题与约束理解。" : "继续补充领域影响。",
    text: "继续收集分析结果。",
    newTodos: round === 0 ? [{ key: "scope", title: "梳理需求范围" }] : [],
    todoUpdates: [],
    calls: [{ todoRef: "scope", kind: "agent", id, objective: round === 0 ? "提取问题、目标、约束与待确认信息" : "分析业务、流程、数据与交付影响" }]
  };
}

export function validateExplorePlan(value: unknown): ExplorePlan | undefined {
  const parsed = explorePlannerOutputSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const calls = parsed.data.calls.filter((call) => call.kind === "agent"
    ? getAgent(call.id)?.modes.includes("explore")
    : Boolean(getExecutableTool(call.id)));
  return { ...parsed.data, calls };
}
