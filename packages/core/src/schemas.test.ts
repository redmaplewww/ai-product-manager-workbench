import { describe, expect, it } from "vitest";
import { agentPacketSchema, agentStepSchema, baselineSchema, pathForCategory, pathToCategory, pmProposalItemSchema, pmSynthesisOutputSchema, proposalChangeSchema, proposalSchema, sendMessageInputSchema } from "./schemas";

describe("domain schemas", () => {
  it("rejects an empty message", () => expect(sendMessageInputSchema.safeParse({ content: "  " }).success).toBe(false));
  it("requires the complete planning hierarchy", () => {
    expect(baselineSchema.safeParse({ summary: "x" }).success).toBe(false);
  });

  it("accepts an evidence-backed agent packet and preserves it on step readback", () => {
    expect(agentPacketSchema.safeParse({
      schemaVersion: 1,
      agentId: "requirements-analyst",
      status: "completed",
      summary: "识别本轮约束",
      assertions: [{ id: "assertion:requirements-analyst:0", basis: "grounded", content: "系统不得自动淘汰候选人", evidenceIds: ["message:msg_1"] }],
      clarificationQuestions: [],
      issues: [{ id: "issue:requirements-analyst:0", kind: "missing_boundary", severity: "warning", targetRefs: [], detail: "边界未明确", evidenceIds: ["message:msg_1"], verification: null }],
      error: null
    }).success).toBe(true);

    const parsed = agentStepSchema.parse({
      id: "step_packet", agent: "需求分析", provider: "OpenAI", model: "test", status: "completed", summary: "新记录",
      result: { schemaVersion: 1, agentId: "requirements-analyst", status: "completed", summary: "新记录", assertions: [{ id: "assertion:requirements-analyst:0", basis: "grounded", content: "保留结构化结果", evidenceIds: ["message:msg_1"] }], clarificationQuestions: [], issues: [], error: null }, durationMs: 1, retries: 0, startedAt: "2026-09-02T00:00:00.000Z"
    });
    expect(parsed.result).toMatchObject({ schemaVersion: 1, assertions: [{ id: "assertion:requirements-analyst:0" }] });
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
    expect(proposal.changes[0].evidenceIds).toEqual([]);
  });

  it("uses one strict canonical PM proposal item schema", () => {
    expect(pmProposalItemSchema.safeParse({ itemIds: ["a"], category: "requirements", content: " ", selected: true }).success).toBe(false);
    expect(pmProposalItemSchema.safeParse({ itemIds: ["a"], category: "requirements", content: "系统支持审批", selected: true }).success).toBe(true);
  });

  it("derives every proposal path from its category without a second hand-written table", () => {
    expect(pathForCategory("requirements")).toBe("/requirements/-");
    expect(pathToCategory("/requirements/-")).toBe("requirements");
    expect(pathToCategory("/nope/-")).toBeUndefined();
    expect(pathToCategory("/requirements")).toBeUndefined();
    expect(proposalChangeSchema.safeParse({ path: "/requirements/-", after: "系统保留依据" }).success).toBe(true);
    expect(proposalChangeSchema.safeParse({ path: "/nope/-", after: "越界" }).success).toBe(false);
  });

  it("validates the persisted PM step output instead of treating it as unknown", () => {
    expect(agentStepSchema.safeParse({
      id: "step_pm", agent: "AI 产品经理", provider: "OpenAI", model: "test", status: "completed", summary: "x",
      output: { answer: "已回答", proposalTitle: null, proposalRationale: null, proposalItems: [], reviewResponses: [], proposalCandidates: [] }, durationMs: 1, retries: 0, startedAt: "2026-09-02T00:00:00.000Z"
    }).success).toBe(true);
    expect(agentStepSchema.safeParse({ id: "step_pm", agent: "AI 产品经理", provider: "OpenAI", model: "test", status: "completed", summary: "x", output: { unexpected: 1 }, durationMs: 1, retries: 0, startedAt: "2026-09-02T00:00:00.000Z" }).success).toBe(false);
  });

  it("keeps packet shape permissive while enforcing failure state consistency", () => {
    const base = {
      schemaVersion: 1 as const,
      summary: "x",
      assertions: [],
      clarificationQuestions: [],
      error: null
    };
    expect(agentPacketSchema.safeParse({ ...base, agentId: "requirements-analyst", status: "completed", issues: [{ id: "i", kind: "contradiction", severity: "warning", targetRefs: [], detail: "x", evidenceIds: [], verification: "confirmed" }] }).success).toBe(true);
    expect(agentPacketSchema.safeParse({ ...base, agentId: "critical-reviewer", status: "completed", issues: [{ id: "i", kind: "contradiction", severity: "warning", targetRefs: [], detail: "x", evidenceIds: [], verification: null }] }).success).toBe(true);
    expect(agentPacketSchema.safeParse({ ...base, agentId: "requirements-analyst", status: "completed", issues: [], error: "failed" }).success).toBe(false);
  });
});
