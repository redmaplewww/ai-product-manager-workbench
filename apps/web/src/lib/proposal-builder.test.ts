import { describe, expect, it } from "vitest";
import { buildProposal } from "./proposal-builder";

describe("buildProposal", () => {
  it("keeps only PM changes backed by extracted candidates", () => {
    const result = buildProposal([
      { content: "支持逐条审批" },
      { content: "保留变更依据" }
    ], {
      title: "审批规则",
      rationale: "把明确的审批要求整理成候选基线变更",
      items: [
        { sourceIndex: 0, category: "requirements", content: "产品编辑可以逐条审批每项变更", selected: true },
        { sourceIndex: 99, category: "requirements", content: "新增自动发布能力", selected: true }
      ]
    });

    expect(result).toMatchObject({ title: "审批规则", rationale: "把明确的审批要求整理成候选基线变更" });
    expect(result?.changes).toEqual([{ path: "/requirements/-", after: "产品编辑可以逐条审批每项变更", selected: true }]);
  });

  it("does not fall back to raw candidate text when PM output is unavailable", () => {
    const result = buildProposal([{ content: "缩短评审时间" }]);
    expect(result).toBeNull();
  });

  it("lets PM classify a supported candidate without inventing a new source", () => {
    const result = buildProposal([
      { content: "服务 HR 完成简历初筛" }
    ], {
      title: "HR 初筛场景",
      rationale: "将明确的业务场景归入目标用户范围",
      items: [{ sourceIndex: 0, category: "audience", content: "HR 招聘人员", selected: true }]
    });

    expect(result?.changes).toEqual([{ path: "/audience/-", after: "HR 招聘人员", selected: true }]);
  });

  it("does not combine PM metadata with raw fallback changes when PM changes are invalid", () => {
    const result = buildProposal([{ content: "用户明确的需求" }], {
      title: "不应冒充已整理提案",
      rationale: "这段元数据不能覆盖无效的 PM 变更",
      items: [{ sourceIndex: 99, category: "requirements", content: "越界功能", selected: true }]
    });

    expect(result).toBeNull();
  });

  it("rejects a PM proposal that only copies the candidate wording", () => {
    const result = buildProposal([{ content: "项目服务 HR 初筛简历" }], {
      title: "HR 场景",
      rationale: "整理产品场景",
      items: [{ sourceIndex: 0, category: "audience", content: "项目服务 HR 初筛简历", selected: true }]
    });

    expect(result).toBeNull();
  });

  it("allows PM to split one source fact into independently classified baseline entries", () => {
    const result = buildProposal([
      { content: "产品编辑逐条批准或拒绝候选提案，只有批准项才能更新正式基线" }
    ], {
      title: "逐条审批规则",
      rationale: "将复合业务规则拆成可审批的独立基线条目",
      items: [
        { sourceIndex: 0, category: "decisions", content: "正式基线仅由获批准的候选提案更新", selected: true },
        { sourceIndex: 0, category: "requirements", content: "系统应支持产品编辑逐条批准或拒绝候选提案", selected: true }
      ]
    });

    expect(result?.changes).toEqual([
      { path: "/decisions/-", after: "正式基线仅由获批准的候选提案更新", selected: true },
      { path: "/requirements/-", after: "系统应支持产品编辑逐条批准或拒绝候选提案", selected: true }
    ]);
  });
});
