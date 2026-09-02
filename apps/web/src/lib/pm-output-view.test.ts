import { describe, expect, it } from "vitest";
import { readPmProposal } from "./pm-output-view";

describe("readPmProposal", () => {
  it("reads the PM proposal from a persisted run output", () => {
    expect(readPmProposal({ proposal: { title: "HR 初筛", rationale: "整理业务场景", changes: [{ path: "/audience/-", after: "HR 招聘人员" }] } })).toEqual({
      title: "HR 初筛",
      rationale: "整理业务场景",
      changes: [{ path: "/audience/-", after: "HR 招聘人员" }]
    });
  });

  it("ignores malformed or missing PM output", () => {
    expect(readPmProposal({ answer: "只有回答" })).toBeUndefined();
    expect(readPmProposal("未知输出")).toBeUndefined();
  });
});
