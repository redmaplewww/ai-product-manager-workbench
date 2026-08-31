import { z } from "zod";
import { getAgent, getExecutableTool } from "./catalog";

const agentCallSchema = z.object({ kind: z.literal("agent"), id: z.enum(["requirements-analyst", "domain-analyst", "delivery-planner"]), objective: z.string().min(1) });
const toolCallSchema = z.object({ kind: z.literal("tool"), id: z.enum(["source-search"]), objective: z.string().min(1) });

export const exploreCallSchema = z.discriminatedUnion("kind", [agentCallSchema, toolCallSchema]);
export const explorePlannerOutputSchema = z.object({ summary: z.string().min(1), text: z.string().min(1), calls: z.array(exploreCallSchema).max(3) });
export type ExploreCall = z.infer<typeof exploreCallSchema>;
export type ExplorePlan = z.infer<typeof explorePlannerOutputSchema>;

export function canRunExploreRound(round: number) {
  return round < 3;
}

export function createDemoExplorePlan(round: number, content: string): ExplorePlan {
  if (round >= 2) {
    return {
      summary: "现有探索结论已足以形成答复。",
      text: `我已完成对“${content}”的探索性分析，并将关键结论保留为候选信息，等待你确认后再进入正式产品基线。`,
      calls: []
    };
  }

  const id = round === 0 ? "requirements-analyst" : "domain-analyst";
  return {
    summary: round === 0 ? "先建立问题与约束理解。" : "继续补充领域影响。",
    text: "继续收集分析结果。",
    calls: [{ kind: "agent", id, objective: round === 0 ? "提取问题、目标、约束与待确认信息" : "分析业务、流程、数据与交付影响" }]
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
