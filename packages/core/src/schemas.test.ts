import { describe, expect, it } from "vitest";
import { baselineSchema, proposalSchema, runSchema, sendMessageInputSchema } from "./schemas";

describe("domain schemas", () => {
  it("rejects an empty message", () => expect(sendMessageInputSchema.safeParse({ content: "  " }).success).toBe(false));
  it("requires an explicit workflow mode for a message", () => {
    expect(sendMessageInputSchema.safeParse({ content: "分析当前风险" }).success).toBe(false);
  });
  it("accepts both supported workflow modes", () => {
    expect(sendMessageInputSchema.safeParse({ content: "分析当前风险", workflowMode: "structured" }).success).toBe(true);
    expect(sendMessageInputSchema.safeParse({ content: "分析当前风险", workflowMode: "explore" }).success).toBe(true);
  });
  it("requires the complete planning hierarchy", () => {
    expect(baselineSchema.safeParse({ summary: "x" }).success).toBe(false);
  });

  it("restricts proposal changes to insertable baseline sections", () => {
    const base = { id: "prop_1", projectId: "project_1", title: "x", rationale: "y", baseVersion: 1, status: "pending", createdAt: "2026-09-01T00:00:00.000Z", changes: [{ path: "/requirements/-", after: "x" }] };
    expect(proposalSchema.safeParse(base).success).toBe(true);
    expect(proposalSchema.safeParse({ ...base, changes: [{ path: "/unknown/-", after: "x" }] }).success).toBe(false);
  });

  it("accepts the minimal unified runtime shape", () => {
    expect(runSchema.safeParse({
      id: "run_1", projectId: "project_1", userMessageId: "message_1", workflowMode: "explore", status: "queued",
      todos: [{ id: "todo_1", title: "梳理需求", status: "open" }], waves: [], costUsd: 0, durationMs: 0, createdAt: "2026-09-01T00:00:00.000Z"
    }).success).toBe(true);
  });

  it("requires explicit solved and remaining sections in an action result", () => {
    const result = runSchema.safeParse({
      id: "run_2", projectId: "project_1", workflowMode: "explore", status: "completed", todos: [],
      waves: [{ id: "wave_1", index: 1, source: "planner", summary: "分析", actions: [{
        id: "action_1", capabilityId: "requirements-analyst", goal: "解决用户问题", status: "succeeded",
        execution: { route: "primary", provider: "OpenAI", model: "x", durationMs: 1, retries: 0 },
        result: { summary: "完成", solved: ["识别核心问题"], remaining: [{ key: "gap_1", question: "首要用户是谁？", suggestedCapabilityIds: ["requirements-analyst"] }], evidenceRefs: ["action_1"] }
      }] }], costUsd: 0, durationMs: 1, createdAt: "2026-09-01T00:00:00.000Z"
    });
    expect(result.success).toBe(true);
  });
});
