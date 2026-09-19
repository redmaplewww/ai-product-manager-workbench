import { describe, expect, it } from "vitest";
import { formatAgentResults } from "./agent-result";

describe("formatAgentResults", () => {
  it("preserves complete packets for the next agent", () => {
    const context = formatAgentResults([
      {
        agentId: "requirements-analyst", agent: "需求分析",
        result: {
          schemaVersion: 1, agentId: "requirements-analyst", status: "completed", summary: "识别出审批需求",
          assertions: [{ id: "assertion:requirements-analyst:0", basis: "grounded", content: "需要逐条审批", evidenceIds: ["message:msg_1"] }], clarificationQuestions: [], issues: [], error: null
        }
      }
    ]);

    const parsed = JSON.parse(context);
    expect(parsed).toEqual([{
      agentId: "requirements-analyst", agent: "需求分析",
      packet: {
        schemaVersion: 1, agentId: "requirements-analyst", status: "completed", summary: "识别出审批需求",
        assertions: [{ id: "assertion:requirements-analyst:0", basis: "grounded", content: "需要逐条审批", evidenceIds: ["message:msg_1"] }], clarificationQuestions: [], issues: [], error: null
      }
    }]);
    expect(context).not.toContain("识别出审批需求；需要逐条审批");
  });
});
