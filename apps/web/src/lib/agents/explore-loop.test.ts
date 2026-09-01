import { describe, expect, it } from "vitest";
import { runExploreLoop } from "./explore-loop";

describe("explore loop", () => {
  it("passes an agent observation to the next ReAct decision", async () => {
    const observationsSeenBySecondDecision: string[] = [];
    const result = await runExploreLoop({
      decide: async (round, observations) => {
        if (round === 0) return { summary: "先看约束", text: "继续分析", newTodos: [], todoUpdates: [], calls: [{ todoRef: "scope", kind: "agent", id: "requirements-analyst", objective: "提取约束" }] };
        observationsSeenBySecondDecision.push(...observations.map((item) => item.result.summary));
        return { summary: "证据充分", text: "已完成分析", newTodos: [], todoUpdates: [], calls: [] };
      },
      execute: async () => ({ actionId: "action_1", summary: "发现两条关键约束", solved: ["角色明确"], remaining: [{ key: "priority", question: "优先级", suggestedCapabilityIds: [] }], evidenceRefs: [] })
    });

    expect(observationsSeenBySecondDecision).toEqual(["发现两条关键约束"]);
    expect(result.answer).toBe("已完成分析");
    expect(result.exhausted).toBe(false);
  });

  it("ends after the third executable round", async () => {
    const result = await runExploreLoop({
      decide: async () => ({ summary: "继续探索", text: "继续", newTodos: [], todoUpdates: [], calls: [{ todoRef: "scope", kind: "agent", id: "requirements-analyst", objective: "继续" }] }),
      execute: async () => ({ actionId: "action_1", summary: "获得观察", solved: [], remaining: [], evidenceRefs: [] })
    });

    expect(result.observations).toHaveLength(3);
    expect(result.exhausted).toBe(true);
  });

  it("executes every call in a planner round before replanning", async () => {
    const executed: string[] = [];
    await runExploreLoop({
      decide: async (round) => round === 0
        ? { summary: "并行收集", text: "继续", newTodos: [], todoUpdates: [], calls: [{ todoRef: "scope", kind: "agent", id: "requirements-analyst", objective: "需求" }, { todoRef: "scope", kind: "agent", id: "domain-analyst", objective: "领域" }] }
        : { summary: "信息足够", text: "已完成", newTodos: [], todoUpdates: [], calls: [] },
      execute: async (action) => { executed.push(action.id); return { actionId: `action_${action.id}`, summary: action.objective, solved: [], remaining: [], evidenceRefs: [] }; }
    });

    expect(executed).toEqual(["requirements-analyst", "domain-analyst"]);
  });
});
