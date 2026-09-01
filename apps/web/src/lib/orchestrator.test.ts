import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error Vitest 4 types omit the virtual-module options supported at runtime.
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock("./env", () => ({ providerBaseUrl: () => undefined }));

import { executeTurn, normalizePmProposal, pmOutputSchema } from "./orchestrator";
import { createSeedState } from "./seed";

const providerKeys = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY"] as const;
const originalValues = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of providerKeys) {
    originalValues.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of providerKeys) {
    const value = originalValues.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalValues.clear();
});

describe("workflow mode integration", () => {
  it("uses a structured PM output contract for grouped proposal sections", () => {
    const parsed = pmOutputSchema.safeParse({
      answer: "综合结论",
      openQuestions: [],
      proposal: {
        title: "候选变更",
        rationale: "来自分析结果",
        audience: [], goals: [], metrics: [], scope: [], nonGoals: [],
        requirements: [{ content: "保留审批记录", evidenceRefs: ["act_1"] }],
        risks: [], decisions: [], openQuestions: []
      }
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.proposal?.requirements[0].evidenceRefs).toEqual(["act_1"]);
  });

  it("always sends the completed exploration context through PM synthesis", async () => {
    const state = await createSeedState();

    const result = await executeTurn(state, "prj_pmstudio", "请仔细分析这个需求？", "产品编辑", "explore");

    expect(result.run.waves.flatMap((wave) => wave.actions.map((action) => action.capabilityId))).toContain("pm-synthesizer");
  });

  it("normalizes grouped PM proposal sections into baseline insertion paths", () => {
    const proposal = normalizePmProposal({
      title: "补充产品约束和决策",
      rationale: "多轮分析形成了两项可审批结论。",
      goals: [],
      scope: [],
      requirements: [{ content: "必须保留审批记录", evidenceRefs: ["act_1"] }],
      risks: [{ content: "候选信息可能被误当成正式结论", evidenceRefs: ["act_2"] }],
      decisions: [{ content: "由统一 PM 对外回答", evidenceRefs: ["act_3"] }],
      openQuestions: []
    });

    expect(proposal.changes).toEqual([
      { path: "/requirements/-", after: "必须保留审批记录", selected: true },
      { path: "/risks/-", after: "候选信息可能被误当成正式结论", selected: true },
      { path: "/decisions/-", after: "由统一 PM 对外回答", selected: true }
    ]);
  });

  it("drops a proposal change that is an exact copy of the user question", () => {
    const proposal = normalizePmProposal({
      title: "错误提案",
      rationale: "不应直接复制问题。",
      goals: [], scope: [],
      requirements: [{ content: "这个产品要咋定位，大概获客，功能", evidenceRefs: [] }],
      risks: [], decisions: [], openQuestions: []
    }, "这个产品要咋定位，大概获客，功能");

    expect(proposal.changes).toEqual([]);
  });

  it("projects an exploration result into a pending proposal without copying the user prompt", async () => {
    const state = await createSeedState();

    const result = await executeTurn(state, "prj_pmstudio", "必须支持多智能体编排", "产品编辑", "explore");

    expect(result.proposal?.status).toBe("pending");
    expect(result.proposal?.changes).toEqual([
      expect.objectContaining({ path: "/requirements/-", after: "必须支持多智能体编排" })
    ]);
    expect(result.proposal?.title).not.toBe("必须支持多智能体编排");
  });

  it("does not project a question into a proposal", async () => {
    const state = await createSeedState();

    const result = await executeTurn(state, "prj_pmstudio", "请仔细分析这个需求？", "产品编辑", "explore");

    expect(result.proposal).toBeNull();
  });

  it("runs both modes while reusing the existing candidate-memory deduplication", async () => {
    const state = await createSeedState();
    const content = "必须支持多智能体编排";
    const proposalCountBeforeRun = state.proposals.length;

    const structured = await executeTurn(state, "prj_pmstudio", content, "产品编辑", "structured");
    const memoryCountAfterStructured = state.memories.length;
    expect(state.proposals).toHaveLength(proposalCountBeforeRun + 1);
    const explore = await executeTurn(state, "prj_pmstudio", content, "产品编辑", "explore");

    expect(structured.run.workflowMode).toBe("structured");
    expect(structured.run.waves.flatMap((wave) => wave.actions.map((action) => action.capabilityId))).toContain("critical-reviewer");
    expect(structured.run.waves).toHaveLength(4);
    expect(structured.run.waves[0].actions).toHaveLength(3);
    expect(explore.run.workflowMode).toBe("explore");
    expect(explore.run.waves.flatMap((wave) => wave.actions.map((action) => action.capabilityId))).toContain("exploration-planner");
    expect(explore.run.todos.length).toBeGreaterThan(0);
    expect(explore.run.todos.every((todo) => todo.status === "done")).toBe(true);
    expect(explore.run.waves[0].source).toBe("planner");
    expect(explore.run.waves[0].actions[0].result?.summary).toBeTruthy();
    expect(state.memories).toHaveLength(memoryCountAfterStructured);
    expect(explore.proposal).toBeNull();
    expect(state.proposals).toHaveLength(proposalCountBeforeRun + 1);
    expect(state.projects[0].baselineVersion).toBe(3);
  });
});
