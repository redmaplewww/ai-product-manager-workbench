import { describe, expect, it } from "vitest";
import { formatAgentResults } from "./agent-result";

describe("formatAgentResults", () => {
  it("preserves typed findings and questions for the next agent", () => {
    const context = formatAgentResults([
      {
        agent: "需求分析",
        result: {
          summary: "识别出审批需求",
          findings: ["需要逐条审批"],
          openQuestions: ["是否需要批量审批？"],
          evidenceRefs: []
        }
      }
    ]);

    const parsed = JSON.parse(context);
    expect(parsed).toEqual([{
      agent: "需求分析",
      result: {
        summary: "识别出审批需求",
        findings: ["需要逐条审批"],
        openQuestions: ["是否需要批量审批？"],
        evidenceRefs: []
      }
    }]);
    expect(context).not.toContain("识别出审批需求；需要逐条审批");
  });
});
