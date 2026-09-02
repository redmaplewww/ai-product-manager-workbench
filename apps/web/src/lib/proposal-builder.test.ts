import { describe, expect, it } from "vitest";
import { buildProposal } from "./proposal-builder";

describe("buildProposal", () => {
  it("keeps only PM changes backed by extracted candidates", () => {
    const result = buildProposal([
      { path: "/requirements/-", after: "支持逐条审批", selected: true },
      { path: "/requirements/-", after: "保留变更依据", selected: true }
    ], {
      title: "审批规则",
      rationale: "把明确的审批要求整理成候选基线变更",
      changes: [
        { sourceIndex: 0, path: "/requirements/-", after: "产品编辑可以逐条审批每项变更", selected: true },
        { sourceIndex: 99, path: "/requirements/-", after: "新增自动发布能力", selected: true }
      ]
    });

    expect(result).toMatchObject({ title: "审批规则", rationale: "把明确的审批要求整理成候选基线变更" });
    expect(result?.changes).toEqual([{ path: "/requirements/-", after: "产品编辑可以逐条审批每项变更", selected: true }]);
  });

  it("creates a structured fallback when PM output is unavailable", () => {
    const result = buildProposal([{ path: "/goals/-", after: "缩短评审时间", selected: true }]);
    expect(result).toMatchObject({ title: expect.any(String), rationale: expect.any(String) });
    expect(result?.changes).toHaveLength(1);
  });
});
