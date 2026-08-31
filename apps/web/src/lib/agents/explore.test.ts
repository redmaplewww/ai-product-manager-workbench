import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canRunExploreRound, createDemoExplorePlan, explorePlannerOutputSchema, validateExplorePlan } from "./explore";

describe("exploration plans", () => {
  it("accepts a plan that calls a registered agent", () => {
    expect(validateExplorePlan({ summary: "先识别约束", text: "继续分析", calls: [{ kind: "agent", id: "requirements-analyst", objective: "提取关键约束" }] })).toEqual({
      summary: "先识别约束",
      text: "继续分析",
      calls: [{ kind: "agent", id: "requirements-analyst", objective: "提取关键约束" }]
    });
  });

  it("rejects an agent call that is not a registered identifier", () => {
    expect(explorePlannerOutputSchema.safeParse({ summary: "需求分析", text: "继续", calls: [{ kind: "agent", id: "req-1", objective: "分析" }] }).success).toBe(false);
  });

  it("removes disabled tool calls from a plan", () => {
    expect(validateExplorePlan({ summary: "尝试检索", text: "没有可用工具", calls: [{ kind: "tool", id: "source-search", objective: "寻找证据" }] })?.calls).toEqual([]);
  });

  it("stops after three exploration rounds", () => {
    expect(canRunExploreRound(1)).toBe(true);
    expect(canRunExploreRound(3)).toBe(false);
  });

  it("uses an agent first and has no calls by the final demo round", () => {
    expect(createDemoExplorePlan(0, "梳理风险").calls).toMatchObject([{ kind: "agent", id: "requirements-analyst" }]);
    expect(createDemoExplorePlan(2, "梳理风险").calls).toEqual([]);
  });

  it("uses a root object schema accepted by the Agents SDK", () => {
    expect(z.toJSONSchema(explorePlannerOutputSchema)).toMatchObject({ type: "object", required: ["summary", "text", "calls"] });
  });
});
