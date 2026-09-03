import { describe, expect, it } from "vitest";
import { readPmProposal } from "./pm-output-view";

describe("readPmProposal", () => {
  it("reads the PM proposal from a persisted run output", () => {
    expect(readPmProposal({ proposalTitle: "HR 初筛", proposalRationale: "整理业务场景", proposal: [{ category: "audience", content: "HR 招聘人员" }] })).toEqual({
      title: "HR 初筛",
      rationale: "整理业务场景",
      items: [{ category: "audience", content: "HR 招聘人员" }]
    });
  });

  it("reads the canonical proposalItems output", () => {
    expect(readPmProposal({ proposalTitle: "HR 初筛", proposalRationale: "整理业务场景", proposalItems: [{ itemIds: ["assertion:requirements-analyst:0"], category: "audience", content: "HR 招聘人员", selected: true }] })).toEqual({
      title: "HR 初筛",
      rationale: "整理业务场景",
      items: [{ category: "audience", content: "HR 招聘人员" }]
    });
  });

  it("ignores malformed or missing PM output", () => {
    expect(readPmProposal({ answer: "只有回答" })).toBeUndefined();
    expect(readPmProposal("未知输出")).toBeUndefined();
  });
});
