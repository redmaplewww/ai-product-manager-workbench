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

  it("normalizes verification fields without blocking malformed ownership", () => {
    expect(normalizeAgentPacket("domain-analyst", {
      summary: "不应自行确认", assertions: [], clarificationQuestions: [],
      issues: [{ kind: "contradiction", severity: "warning", targetRefs: [], detail: "矛盾", evidenceIds: [], verification: "confirmed" }]
    }, []).issues[0].verification).toBeNull();
    expect(normalizeAgentPacket("critical-reviewer", {
      summary: "已核验", assertions: [], clarificationQuestions: [],
      issues: [{ kind: "contradiction", severity: "warning", targetRefs: ["issue:domain-analyst:0"], detail: "确认矛盾", evidenceIds: [], verification: null }]
    }, [], ["issue:domain-analyst:0"]).issues[0].verification).toBe("unresolved");
  });

  it("keeps assertions as task deliverables without PM routing metadata", () => {
    const packet = normalizeAgentPacket("domain-analyst", {
      summary: "分析",
      assertions: [{ basis: "grounded", content: "现有流程存在审批边界", evidenceIds: ["message:msg_1"] }],
      clarificationQuestions: [], issues: []
    }, ["message:msg_1"]);
    expect(packet.assertions[0]).not.toHaveProperty("proposalEligible");
  });
});
