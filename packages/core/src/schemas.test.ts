import { describe, expect, it } from "vitest";
import { agentPacketSchema, agentStepSchema, baselineSchema, pmSynthesisOutputSchema, proposalSchema, sendMessageInputSchema } from "./schemas";

describe("domain schemas", () => {
  it("rejects an empty message", () => expect(sendMessageInputSchema.safeParse({ content: "  " }).success).toBe(false));
  it("requires the complete planning hierarchy", () => {
    expect(baselineSchema.safeParse({ summary: "x" }).success).toBe(false);
  });

  it("accepts an evidence-backed agent packet and keeps legacy results readable", () => {
    expect(agentPacketSchema.safeParse({
      schemaVersion: 1,
      agentId: "requirements-analyst",
      status: "completed",
      summary: "识别本轮约束",
      assertions: [{ id: "assertion:requirements-analyst:0", basis: "grounded", content: "系统不得自动淘汰候选人", evidenceIds: ["message:msg_1"] }],
      clarificationQuestions: [],
      issues: [],
      error: null
    }).success).toBe(true);

    expect(agentStepSchema.safeParse({
      id: "step_1", agent: "需求分析", provider: "OpenAI", model: "test", status: "completed", summary: "旧记录",
      result: { summary: "旧记录", findings: ["旧 finding"], openQuestions: [], evidenceRefs: [] }, durationMs: 1, retries: 0, startedAt: "2026-09-02T00:00:00.000Z"
    }).success).toBe(true);
  });

  it("requires PM review responses and retains proposal evidence item IDs", () => {
    expect(pmSynthesisOutputSchema.safeParse({
      answer: "发现矛盾，未创建提案。",
      reviewResponses: [{ issueId: "issue:critic:0", disposition: "needs_clarification", message: "请确认以哪条规则为准。" }],
      proposalTitle: null,
      proposalRationale: null,
      proposalItems: []
    }).success).toBe(true);

    const proposal = proposalSchema.parse({
      id: "prop_1", projectId: "prj_1", title: "测试", rationale: "测试", baseVersion: 1, status: "pending",
      changes: [{ path: "/requirements/-", after: "系统保留依据" }], createdAt: "2026-09-02T00:00:00.000Z"
    });
    expect(proposal.changes[0].evidenceItemIds).toEqual([]);
  });
});
