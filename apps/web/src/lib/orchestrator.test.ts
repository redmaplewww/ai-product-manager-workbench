import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error Vitest 4 types omit the virtual-module options supported at runtime.
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock("./env", () => ({ providerBaseUrl: () => undefined }));

import { executeTurn } from "./orchestrator";
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
  it("runs both modes while reusing the existing candidate-memory deduplication", async () => {
    const state = await createSeedState();
    const content = "必须支持多智能体编排";
    const proposalCountBeforeRun = state.proposals.length;

    const structured = await executeTurn(state, "prj_pmstudio", content, "产品编辑", "structured");
    const memoryCountAfterStructured = state.memories.length;
    const explore = await executeTurn(state, "prj_pmstudio", content, "产品编辑", "explore");

    expect(structured.run.workflowMode).toBe("structured");
    expect(structured.run.steps.map((step) => step.agent)).toContain("批判评审");
    expect(explore.run.workflowMode).toBe("explore");
    expect(explore.run.steps.map((step) => step.agent)).toContain("探索规划");
    expect(state.memories).toHaveLength(memoryCountAfterStructured);
    expect(state.proposals).toHaveLength(proposalCountBeforeRun);
    expect(state.projects[0].baselineVersion).toBe(3);
  });
});
