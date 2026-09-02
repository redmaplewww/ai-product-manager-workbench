import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMock, runnerConfig } = vi.hoisted(() => ({ runMock: vi.fn(), runnerConfig: {} as Record<string, unknown> }));

// @ts-expect-error Vitest supports virtual modules at runtime.
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock("./env", () => ({ providerBaseUrl: () => undefined }));
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

import { executeTurn, normalizePmOutput, normalizeReviewOutput } from "./orchestrator";
import { createSeedState } from "./seed";

describe("executeTurn integration", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPSEEK_API_KEY;
    runMock.mockImplementation(async (agent: { name: string }) => {
      if (agent.name === "AI 产品经理") {
        return { finalOutput: {
          answer: "已将 HR 招聘人员归入本轮候选产品范围。",
          openQuestions: [],
          proposalTitle: "HR 初筛场景",
          proposalRationale: "将本轮明确场景整理为目标用户候选变更。",
          proposal: [{ sourceIndex: 0, category: "audience", content: "HR 招聘人员", selected: true }]
        } };
      }
      return { finalOutput: { summary: `${agent.name}结论`, findings: ["保留结构化发现"], openQuestions: ["待确认边界"], evidenceRefs: [] } };
    });
  });

  it("persists PM-classified proposal changes and structured agent results in one turn", async () => {
    const state = await createSeedState();
    const result = await executeTurn(state, "prj_pmstudio", "这个项目服务 HR 初步筛选人才简历。", "产品编辑");

    expect(result.proposal).toMatchObject({ title: "HR 初筛场景", rationale: "将本轮明确场景整理为目标用户候选变更。" });
    expect(result.proposal?.changes).toEqual([{ path: "/audience/-", after: "HR 招聘人员", selected: true }]);
    expect(result.run.steps.find((step) => step.agent === "需求分析")?.result).toMatchObject({ findings: ["保留结构化发现"], openQuestions: ["待确认边界"] });
    expect(result.run.steps.find((step) => step.agent === "PM 综合")?.summary).toBe("已将 HR 招聘人员归入本轮候选产品范围。");
    expect(result.run.steps.find((step) => step.agent === "PM 综合")?.output).toMatchObject({ proposalTitle: "HR 初筛场景", proposal: [{ category: "audience" }] });
    expect(runnerConfig).toMatchObject({ tracingDisabled: true });
    const pmInput = runMock.mock.calls.find(([agent]) => (agent as { name: string }).name === "AI 产品经理")?.[1] as string;
    expect(pmInput).toContain('"sourceIndex":0');
    expect(pmInput).not.toContain('"path":"/requirements/-"');
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
    }, [{ content: "HR 招聘人员" }]);

    expect(normalized).toMatchObject({
      answer: "已完成整理。",
      proposalTitle: "HR 初筛场景",
      proposal: [{ sourceIndex: 0, category: "audience", content: "HR 招聘人员", selected: true }]
    });
  });

  it("accepts explicit null proposal metadata required by strict structured output", () => {
    expect(normalizePmOutput({ answer: "已回答。", proposalTitle: null, proposalRationale: null, proposal: null }, [])).toEqual({
      answer: "已回答。",
      proposalTitle: null,
      proposalRationale: null,
      proposal: null
    });
  });

  it("keeps reviewer markdown out of the summary channel", () => {
    const normalized = normalizeReviewOutput("### 可验证矛盾\n- 基线与本轮输入不一致\n### 假设\n- 用户尚未确认发送渠道\n### 需要澄清\n- 是否需要人工复核");

    expect(normalized.summary).not.toContain("###");
    expect(normalized.findings).toEqual(["基线与本轮输入不一致"]);
    expect(normalized.openQuestions).toEqual(["是否需要人工复核"]);
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
  });
});
