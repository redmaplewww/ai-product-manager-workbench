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

  it("does not fall back to raw candidate text when PM output is unavailable", () => {
    const result = buildProposal([{ path: "/goals/-", after: "缩短评审时间", selected: true }]);
    expect(result).toBeNull();
  });

  it("lets PM classify a supported candidate without inventing a new source", () => {
    const result = buildProposal([
      { path: "/requirements/-", after: "服务 HR 完成简历初筛", selected: true }
    ], {
      title: "HR 初筛场景",
      rationale: "将明确的业务场景归入目标用户范围",
      changes: [{ sourceIndex: 0, path: "/audience/-", after: "HR 招聘人员", selected: true }]
    });

    expect(result?.changes).toEqual([{ path: "/audience/-", after: "HR 招聘人员", selected: true }]);
  });

  it("does not combine PM metadata with raw fallback changes when PM changes are invalid", () => {
    const result = buildProposal([{ path: "/requirements/-", after: "用户明确的需求", selected: true }], {
      title: "不应冒充已整理提案",
      rationale: "这段元数据不能覆盖无效的 PM 变更",
      changes: [{ sourceIndex: 99, path: "/requirements/-", after: "越界功能", selected: true }]
    });

    expect(result).toBeNull();
  });

  it("rejects a PM proposal that only copies the candidate wording", () => {
    const result = buildProposal([{ path: "/requirements/-", after: "项目服务 HR 初筛简历", selected: true }], {
      title: "HR 场景",
      rationale: "整理产品场景",
      changes: [{ sourceIndex: 0, path: "/audience/-", after: "项目服务 HR 初筛简历", selected: true }]
    });

    expect(result).toBeNull();
  });
});
