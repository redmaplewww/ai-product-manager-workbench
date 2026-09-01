import { describe, expect, it } from "vitest";
import { migrateLegacyRun, migrateStudioState } from "./state-migration";

describe("legacy runtime migration", () => {
  it("converts old flat steps into one structured legacy wave", () => {
    const migrated = migrateLegacyRun({
      id: "run_old", projectId: "project_1", status: "completed", costUsd: 0, durationMs: 20, demoMode: true,
      createdAt: "2026-08-31T00:00:00.000Z", steps: [{
        id: "step_1", agent: "需求分析", provider: "Demo", model: "demo", status: "completed", summary: "已识别需求", durationMs: 20, retries: 0, startedAt: "2026-08-31T00:00:00.000Z"
      }]
    });

    expect(migrated.workflowMode).toBe("structured");
    expect(migrated.userMessageId).toBeUndefined();
    expect(migrated.waves).toHaveLength(1);
    expect(migrated.waves[0].source).toBe("workflow");
    expect(migrated.waves[0].actions[0].capabilityId).toBe("requirements-analyst");
    expect(migrated.waves[0].actions[0].result.summary).toBe("已识别需求");
  });

  it("derives the old run's user message reference during state migration", () => {
    const state = migrateStudioState({
      messages: [
        { id: "msg_1", role: "user", content: "分析需求" },
        { id: "msg_2", role: "assistant", content: "结果", runId: "run_old" }
      ],
      runs: [{ id: "run_old", projectId: "project_1", status: "completed", costUsd: 0, durationMs: 1, demoMode: true, steps: [] }]
    });

    expect(state.runs[0].userMessageId).toBe("msg_1");
  });

  it("migrates existing waves from findings and gaps to solved and remaining", () => {
    const migrated = migrateLegacyRun({
      id: "run_new", projectId: "project_1", status: "completed", costUsd: 0, durationMs: 1, createdAt: "2026-08-31T00:00:00.000Z",
      waves: [{ id: "wave_1", index: 1, source: "planner", summary: "分析", actions: [{
        id: "action_1", capabilityId: "requirements-analyst", goal: "分析", status: "succeeded",
        execution: { route: "primary", durationMs: 1, retries: 0 },
        result: { summary: "旧结果", findings: ["已解决"], gaps: ["还缺用户"], evidenceRefs: [] }
      }] }]
    });
    expect(migrated.waves[0].actions[0].result).toMatchObject({ solved: ["已解决"], remaining: [{ question: "还缺用户" }] });
  });
});
