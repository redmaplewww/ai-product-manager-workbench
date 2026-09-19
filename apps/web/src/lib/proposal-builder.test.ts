import { describe, expect, it } from "vitest";
import { buildProposal } from "./proposal-builder";

describe("buildProposal", () => {
  it("keeps only PM changes backed by extracted candidates", () => {
    const result = buildProposal([
      { id: "pc_0", content: "支持逐条审批", kind: "assertion", evidenceIds: ["message:msg_1"] },
      { id: "pc_1", content: "保留变更依据", kind: "assertion" }
    ], {
      title: "审批规则",
      rationale: "把明确的审批要求整理成候选基线变更",
      items: [
        { itemIds: ["pc_0"], category: "requirements", content: "产品编辑可以逐条审批每项变更", selected: true },
        { itemIds: ["missing"], category: "requirements", content: "新增自动发布能力", selected: true }
      ]
    });

    expect(result).toMatchObject({ title: "审批规则", rationale: "把明确的审批要求整理成候选基线变更" });
    expect(result?.changes).toEqual([{ path: "/requirements/-", after: "产品编辑可以逐条审批每项变更", selected: true, evidenceIds: ["message:msg_1"] }]);
  });

  it("lets PM decide whether a task deliverable becomes a proposal", () => {
    const result = buildProposal([{ id: "pc_0", content: "分析结论", kind: "assertion", evidenceIds: ["message:msg_1"] }], {
      title: "不应创建",
      rationale: "分析文字不是产品变更",
      items: [{ itemIds: ["pc_0"], category: "requirements", content: "系统必须支持某能力", selected: true }]
    });
    expect(result?.changes).toEqual([{ path: "/requirements/-", after: "系统必须支持某能力", selected: true, evidenceIds: ["message:msg_1"] }]);
  });

  it("does not fall back to raw candidate text when PM output is unavailable", () => {
    const result = buildProposal([{ id: "pc_0", content: "缩短评审时间", kind: "assertion" }]);
    expect(result).toBeNull();
  });

  it("lets PM classify a supported candidate without inventing a new source", () => {
    const result = buildProposal([
      { id: "pc_0", content: "服务 HR 完成简历初筛", kind: "assertion" }
    ], {
      title: "HR 初筛场景",
      rationale: "将明确的业务场景归入目标用户范围",
      items: [{ itemIds: ["pc_0"], category: "audience", content: "HR 招聘人员", selected: true }]
    });

    expect(result?.changes).toEqual([{ path: "/audience/-", after: "HR 招聘人员", selected: true, evidenceIds: [] }]);
  });

  it("does not combine PM metadata with raw fallback changes when PM changes are invalid", () => {
    const result = buildProposal([{ id: "pc_0", content: "用户明确的需求", kind: "assertion" }], {
      title: "不应冒充已整理提案",
      rationale: "这段元数据不能覆盖无效的 PM 变更",
      items: [{ itemIds: ["missing"], category: "requirements", content: "越界功能", selected: true }]
    });

    expect(result).toBeNull();
  });

  it("rejects a PM proposal that only copies the candidate wording", () => {
    const result = buildProposal([{ id: "pc_0", content: "项目服务 HR 初筛简历", kind: "assertion" }], {
      title: "HR 场景",
      rationale: "整理产品场景",
      items: [{ itemIds: ["pc_0"], category: "audience", content: "项目服务 HR 初筛简历", selected: true }]
    });

    expect(result).toBeNull();
  });

  it("allows PM to split one source fact into independently classified baseline entries", () => {
    const result = buildProposal([
      { id: "pc_0", content: "产品编辑逐条批准或拒绝候选提案，只有批准项才能更新正式基线", kind: "assertion" }
    ], {
      title: "逐条审批规则",
      rationale: "将复合业务规则拆成可审批的独立基线条目",
      items: [
        { itemIds: ["pc_0"], category: "decisions", content: "正式基线仅由获批准的候选提案更新", selected: true },
        { itemIds: ["pc_0"], category: "requirements", content: "系统应支持产品编辑逐条批准或拒绝候选提案", selected: true }
      ]
    });

    expect(result?.changes).toEqual([
      { path: "/decisions/-", after: "正式基线仅由获批准的候选提案更新", selected: true, evidenceIds: [] },
      { path: "/requirements/-", after: "系统应支持产品编辑逐条批准或拒绝候选提案", selected: true, evidenceIds: [] }
    ]);
  });

  it("only permits an open-question candidate to create an open-question proposal", () => {
    const result = buildProposal([
      { id: "pc_q0", content: "飞书是否作为首发交付渠道？", kind: "clarification_question" }
    ], {
      title: "渠道待确认",
      rationale: "保留未决的渠道选择",
      items: [{ itemIds: ["pc_q0"], category: "requirements", content: "系统必须接入飞书", selected: true }]
    });

    expect(result).toBeNull();
  });

  it("does not allow an open-question candidate to be mixed into a requirement", () => {
    const result = buildProposal([
      { id: "pc_f0", content: "系统保留筛选依据", kind: "assertion" },
      { id: "pc_q0", content: "飞书是否作为首发交付渠道？", kind: "clarification_question" }
    ], {
      title: "错误混合",
      rationale: "开放问题不能伪装成需求依据",
      items: [{ itemIds: ["pc_f0", "pc_q0"], category: "requirements", content: "系统必须接入飞书并保留筛选依据", selected: true }]
    });

    expect(result).toBeNull();
  });
});
