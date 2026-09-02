import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

// @ts-expect-error Vitest supports virtual modules at runtime.
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock("./env", () => ({ providerBaseUrl: () => undefined }));
vi.mock("@openai/agents", () => ({
  Agent: class {
    name: string;
    constructor(options: { name: string }) { this.name = options.name; }
  },
  OpenAIProvider: class {},
  run: runMock,
  setDefaultModelProvider: vi.fn()
}));

import { executeTurn } from "./orchestrator";
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
          proposal: {
            title: "HR 初筛场景",
            rationale: "将本轮明确场景整理为目标用户候选变更。",
            changes: [{ sourceIndex: 0, path: "/audience/-", after: "HR 招聘人员", selected: true }]
          }
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
    expect(state.memories.some((memory) => memory.content.includes("HR 初步筛选人才简历"))).toBe(true);
  });
});
