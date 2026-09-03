import { planMemoryUpdates } from "@pm-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMock, runnerConfig, extractMemoryMock } = vi.hoisted(() => ({ runMock: vi.fn(), runnerConfig: {} as Record<string, unknown>, extractMemoryMock: vi.fn() }));

// @ts-expect-error Vitest supports virtual modules at runtime.
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock("./env", () => ({ providerBaseUrl: () => undefined }));
vi.mock("./tools/memory-extractor", () => ({ extractMemory: extractMemoryMock }));
vi.mock("@openai/agents", () => ({
  Agent: class {
    name: string;
    constructor(options: { name: string }) { this.name = options.name; }
  },
  OpenAIProvider: class {},
  Runner: class {
    constructor(config: Record<string, unknown>) { Object.assign(runnerConfig, config); }
    run(...args: unknown[]) { return runMock(...args); }
  },
  setDefaultModelProvider: vi.fn()
}));

import { composePmAnswer, ensureCriticIssueCoverage, executeTurn, normalizePmOutput, normalizeReviewOutput } from "./orchestrator";
import { createSeedState } from "./seed";

describe("executeTurn integration", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPSEEK_API_KEY;
    extractMemoryMock.mockImplementation(({ content, memories, sourceMessageId }) => planMemoryUpdates(content, memories, sourceMessageId));
    runMock.mockImplementation(async (agent: { name: string }, input: string) => {
      if (agent.name === "AI 产品经理") {
        return { finalOutput: {
          answer: "已将 HR 招聘人员归入本轮候选产品范围。",
          reviewResponses: [],
          openQuestions: [],
          proposalTitle: "HR 初筛场景",
          proposalRationale: "将本轮明确场景整理为目标用户候选变更。",
          proposalItems: [{ itemIds: ["assertion:requirements-analyst:0"], category: "audience", content: "HR 招聘人员", selected: true }]
        } };
      }
      const messageId = input.match(/\[message:(msg_[^\]]+)\]/)?.[1];
      return { finalOutput: { summary: `${agent.name}结论`, assertions: [{ basis: "grounded", content: "服务 HR 完成简历初筛", evidenceIds: messageId ? [`message:${messageId}`] : [] }], clarificationQuestions: [], issues: [] } };
    });
  });

  it("persists PM-classified proposal changes and structured agent results in one turn", async () => {
    const state = await createSeedState();
    const result = await executeTurn(state, "prj_pmstudio", "这个项目服务 HR 初步筛选人才简历。", "产品编辑");

    expect(result.proposal).toMatchObject({ title: "HR 初筛场景", rationale: "将本轮明确场景整理为目标用户候选变更。" });
    expect(result.proposal?.changes).toEqual([{ path: "/audience/-", after: "HR 招聘人员", selected: true, evidenceItemIds: ["assertion:requirements-analyst:0"], evidenceIds: ["message:msg_1"] }]);
    expect(result.run.steps.find((step) => step.agent === "需求分析")?.result).toMatchObject({ assertions: [{ id: "assertion:requirements-analyst:0" }] });
    expect(result.run.steps.find((step) => step.agent === "PM 综合")?.summary).toBe("已将 HR 招聘人员归入本轮候选产品范围。");
    expect(result.run.steps.find((step) => step.agent === "PM 综合")?.output).toMatchObject({ proposalTitle: "HR 初筛场景", proposalItems: [{ itemIds: ["assertion:requirements-analyst:0"], category: "audience" }] });
    expect(runnerConfig).toMatchObject({ tracingDisabled: true });
    const pmInput = runMock.mock.calls.find(([agent]) => (agent as { name: string }).name === "AI 产品经理")?.[1] as string;
    expect(pmInput).toContain('"id":"assertion:requirements-analyst:0"');
    expect(pmInput).toContain("baseline:v3:");
    expect(pmInput).not.toContain("[记忆整理结果]");
    expect(state.memories.some((memory) => memory.content.includes("HR 初步筛选人才简历"))).toBe(true);
  });

  it("normalizes a legacy PM proposal object without downgrading the whole PM step", () => {
    const normalized = normalizePmOutput({
      answer: "已完成整理。",
      proposal: {
        title: "HR 初筛场景",
        rationale: "把候选事实整理为基线条目。",
        changes: [{ path: "/audience/-", after: "HR 招聘人员", selected: true }]
      }
    }, [{ id: "pc_0", content: "HR 招聘人员", kind: "assertion" }]);

    expect(normalized).toMatchObject({
      answer: "已完成整理。",
      proposalTitle: "HR 初筛场景",
      proposalItems: [{ itemIds: ["pc_0"], category: "audience", content: "HR 招聘人员", selected: true }]
    });
  });

  it("accepts explicit null proposal metadata required by strict structured output", () => {
    expect(normalizePmOutput({ answer: "已回答。", proposalTitle: null, proposalRationale: null, proposal: null }, [])).toEqual({
      answer: "已回答。",
      reviewResponses: [],
      proposalTitle: null,
      proposalRationale: null,
      proposalItems: []
    });
  });

  it("normalizes the canonical proposalItems field", () => {
    expect(normalizePmOutput({ answer: "已回答。", reviewResponses: [], proposalTitle: "整理", proposalRationale: "候选", proposalItems: [{ itemIds: ["pc_0"], category: "requirements", content: "系统必须支持审批", selected: true }] }, [{ id: "pc_0", content: "支持审批", kind: "assertion" }])).toMatchObject({
      proposalItems: [{ itemIds: ["pc_0"], category: "requirements" }]
    });
  });

  it("requires critic JSON packets and marks malformed critic output as failed", () => {
    const normalized = normalizeReviewOutput(JSON.stringify({
      summary: "发现约束矛盾",
      assertions: [],
      clarificationQuestions: [{ content: "应以哪条约束为准？", evidenceIds: ["message:msg_1"] }],
      issues: [{ kind: "contradiction", severity: "blocking", targetRefs: ["assertion:requirements-analyst:0"], detail: "新旧约束相反", evidenceIds: ["message:msg_1"], verification: "confirmed" }]
    }), ["message:msg_1"], ["assertion:requirements-analyst:0"]);

    expect(normalized).toMatchObject({ status: "completed", issues: [{ id: "issue:critical-reviewer:0", kind: "contradiction" }] });
    expect(normalizeReviewOutput("not json", [], []).status).toBe("failed");
  });

  it("requires every critic issue to become a visible PM review response", () => {
    const critic = normalizeReviewOutput(JSON.stringify({
      summary: "发现约束矛盾", assertions: [], clarificationQuestions: [],
      issues: [{ kind: "contradiction", severity: "blocking", targetRefs: [], detail: "新旧约束相反", evidenceIds: [], verification: "confirmed" }]
    }), [], []);

    expect(() => composePmAnswer("PM 正文", [], critic)).toThrow("UNHANDLED_CRITIC_ISSUE");
    expect(composePmAnswer("PM 正文", [{ issueId: "issue:critical-reviewer:0", disposition: "needs_clarification", message: "发现新旧约束相反，请确认以哪条为准。" }], critic)).toContain("发现新旧约束相反");
  });

  it("adds an unresolved critic issue for every expert issue without coverage", () => {
    const expertPacket = { schemaVersion: 1 as const, agentId: "domain-analyst", status: "completed" as const, summary: "x", assertions: [], clarificationQuestions: [], issues: [{ id: "issue:domain-analyst:0", kind: "contradiction" as const, severity: "warning" as const, targetRefs: [], detail: "专家报告矛盾", evidenceIds: [], verification: null }], error: null };
    const critic = { schemaVersion: 1 as const, agentId: "critical-reviewer", status: "completed" as const, summary: "x", assertions: [], clarificationQuestions: [], issues: [], error: null };
    const covered = ensureCriticIssueCoverage([expertPacket], critic);
    expect(covered.issues).toMatchObject([{ targetRefs: ["issue:domain-analyst:0"], verification: "unresolved" }]);
  });

  it("records the PM failure reason instead of hiding it behind Demo", async () => {
    runMock.mockImplementation(async (agent: { name: string }) => {
      if (agent.name === "AI 产品经理") throw new Error("PM_SCHEMA_FAIL");
      return { finalOutput: { summary: `${agent.name}结论`, findings: [], openQuestions: [], evidenceRefs: [] } };
    });

    const state = await createSeedState();
    const result = await executeTurn(state, "prj_pmstudio", "这个项目服务 HR 初步筛选人才简历。", "产品编辑");
    const pmStep = result.run.steps.find((step) => step.agent === "PM 综合");

    expect(pmStep?.summary).toContain("PM_SCHEMA_FAIL");
    expect(pmStep?.output).toMatchObject({ fallbackReason: "PM_SCHEMA_FAIL" });
    expect(pmStep?.status).toBe("failed");
  });

  it("creates a proposal from expert candidates when memory extraction finds nothing", async () => {
    extractMemoryMock.mockReturnValue({ creates: [], merges: [], blockingConflictIds: [] });
    const state = await createSeedState();
    const result = await executeTurn(state, "prj_pmstudio", "这个项目服务 HR 初步筛选人才简历。", "产品编辑");

    expect(result.proposal?.changes).toEqual([{ path: "/audience/-", after: "HR 招聘人员", selected: true, evidenceItemIds: ["assertion:requirements-analyst:0"], evidenceIds: ["message:msg_1"] }]);
    expect(state.memories.some((memory) => memory.content.includes("HR 初步筛选人才简历"))).toBe(false);
  });
});
