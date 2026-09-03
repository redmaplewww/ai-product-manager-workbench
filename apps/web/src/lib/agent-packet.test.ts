import { describe, expect, it } from "vitest";
import { normalizeAgentPacket } from "./agent-packet";

describe("normalizeAgentPacket", () => {
  it("assigns stable IDs and preserves only supplied evidence IDs", () => {
    const packet = normalizeAgentPacket("requirements-analyst", {
      summary: "识别到审批约束",
      assertions: [{ basis: "grounded", content: "系统应支持逐条审批", evidenceIds: ["message:msg_1"] }],
      clarificationQuestions: [{ content: "是否需要审批理由？", evidenceIds: ["message:msg_1"] }],
      issues: []
    }, ["message:msg_1"]);

    expect(packet).toMatchObject({
      schemaVersion: 1,
      agentId: "requirements-analyst",
      status: "completed",
      assertions: [{ id: "assertion:requirements-analyst:0", evidenceIds: ["message:msg_1"] }],
      clarificationQuestions: [{ id: "question:requirements-analyst:0", evidenceIds: ["message:msg_1"] }]
    });
  });

  it("rejects model references to evidence that was not in context", () => {
    expect(() => normalizeAgentPacket("requirements-analyst", {
      summary: "越权引用",
      assertions: [{ basis: "grounded", content: "系统应支持逐条审批", evidenceIds: ["source:unknown"] }],
      clarificationQuestions: [],
      issues: []
    }, ["message:msg_1"])).toThrow("UNKNOWN_EVIDENCE_ID");
  });

  it("requires grounded assertions to cite evidence and assumptions to remain uncited", () => {
    expect(() => normalizeAgentPacket("requirements-analyst", {
      summary: "无依据结论", assertions: [{ basis: "grounded", content: "系统应支持逐条审批", evidenceIds: [] }], clarificationQuestions: [], issues: []
    }, ["message:msg_1"])).toThrow("GROUNDED_ASSERTION_REQUIRES_EVIDENCE");
    expect(() => normalizeAgentPacket("requirements-analyst", {
      summary: "错误假设", assertions: [{ basis: "assumption", content: "可能需要批量审批", evidenceIds: ["message:msg_1"] }], clarificationQuestions: [], issues: []
    }, ["message:msg_1"])).toThrow("ASSUMPTION_CANNOT_CITE_EVIDENCE");
  });
});
