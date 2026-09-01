import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canFinishExplorePlan, canRunExploreRound, createDemoExplorePlan, explorePlannerOutputSchema, filterRepeatedExploreCalls, validateExplorePlan } from "./explore";

describe("exploration plans", () => {
  it("accepts a plan that calls a registered agent", () => {
    expect(validateExplorePlan({ summary: "先识别约束", text: "继续分析", newTodos: [{ key: "scope", title: "梳理需求范围" }], todoUpdates: [], calls: [{ todoRef: "scope", kind: "agent", id: "requirements-analyst", objective: "提取关键约束" }] })).toEqual({
      summary: "先识别约束",
      text: "继续分析",
      newTodos: [{ key: "scope", title: "梳理需求范围" }],
      todoUpdates: [],
      calls: [{ todoRef: "scope", kind: "agent", id: "requirements-analyst", objective: "提取关键约束" }]
    });
  });

  it("rejects an agent call that is not a registered identifier", () => {
    expect(explorePlannerOutputSchema.safeParse({ summary: "需求分析", text: "继续", newTodos: [], todoUpdates: [], calls: [{ todoRef: "scope", kind: "agent", id: "req-1", objective: "分析" }] }).success).toBe(false);
  });

  it("removes disabled tool calls from a plan", () => {
    expect(validateExplorePlan({ summary: "尝试检索", text: "没有可用工具", newTodos: [], todoUpdates: [], calls: [{ todoRef: "scope", kind: "tool", id: "source-search", objective: "寻找证据" }] })?.calls).toEqual([]);
  });

  it("stops after three exploration rounds", () => {
    expect(canRunExploreRound(1)).toBe(true);
    expect(canRunExploreRound(3)).toBe(false);
  });

  it("does not allow an empty-call plan to leave an open todo", () => {
    const plan = { summary: "结束", text: "已完成", newTodos: [], todoUpdates: [], calls: [] };
    expect(canFinishExplorePlan(plan, [{ id: "scope", title: "梳理需求", status: "open" }])).toBe(false);
    expect(canFinishExplorePlan({ ...plan, todoUpdates: [{ todoId: "scope", status: "done" }] }, [{ id: "scope", title: "梳理需求", status: "open" }])).toBe(true);
  });

  it("uses an agent first and has no calls by the final demo round", () => {
    expect(createDemoExplorePlan(0, "梳理风险").calls).toMatchObject([{ todoRef: "scope", kind: "agent", id: "requirements-analyst" }]);
    expect(createDemoExplorePlan(2, "梳理风险").calls).toEqual([]);
  });

  it("uses a root object schema accepted by the Agents SDK", () => {
    const schema = z.toJSONSchema(explorePlannerOutputSchema);
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["summary", "text", "calls"]));
  });

  it("filters an unqualified repeat but allows a repeat tied to a remaining gap", () => {
    const plan = createDemoExplorePlan(0, "梳理需求");
    const history = [{ action: plan.calls[0], actionId: "action_1", remainingGapKeys: ["gap_user"] }];
    const filtered = filterRepeatedExploreCalls({ ...plan, calls: [
      plan.calls[0],
      { ...plan.calls[0], objective: "深入比较候选用户", basedOnGap: { actionId: "action_1", gapKey: "gap_user" } }
    ] }, history);
    expect(filtered.calls).toHaveLength(1);
    expect(filtered.calls[0].basedOnGap).toEqual({ actionId: "action_1", gapKey: "gap_user" });
  });

  it("allows the same capability on a different todo", () => {
    const plan = createDemoExplorePlan(0, "梳理需求");
    const filtered = filterRepeatedExploreCalls(plan, [{ action: { ...plan.calls[0], todoRef: "other-todo" }, actionId: "action_2", remainingGapKeys: [] }]);
    expect(filtered.calls).toHaveLength(1);
  });
});
