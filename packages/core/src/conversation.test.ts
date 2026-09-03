import { describe, expect, it } from "vitest";
import type { MemoryItem, ProductBaseline, StudioState } from "./schemas";
import { assembleProductContext, assertMemoryTransition, planMemoryUpdates } from "./conversation";

const baseline: ProductBaseline = {
  summary: "持续型 AI 产品经理",
  problem: "讨论容易丢失上下文",
  audience: ["产品团队"],
  goals: ["形成可追溯共识"],
  metrics: ["引用准确率"],
  scope: ["持续对话"],
  nonGoals: ["自动修改代码"],
  requirements: ["所有正式变更必须人工审批"],
  risks: ["错误记忆放大"],
  decisions: ["经理 Agent 保留最终回答权"],
  openQuestions: ["首批项目类型是什么？"],
  outcomes: []
};

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "mem_1",
    projectId: "project_1",
    type: "constraint",
    content: "AI 不能自动修改正式产品基线",
    confidence: 1,
    status: "confirmed",
    sourceMessageIds: ["message_1"],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

describe("conversation memory planning", () => {
  it("deduplicates an equivalent memory and preserves its source trail", () => {
    const result = planMemoryUpdates("AI不能自动修改正式产品基线。", [memory()], "message_2");
    expect(result.creates).toHaveLength(0);
    expect(result.merges).toEqual([{ memoryId: "mem_1", sourceMessageId: "message_2" }]);
  });

  it("creates a conflict instead of replacing a confirmed constraint", () => {
    const result = planMemoryUpdates("以后允许 AI 自动修改正式产品基线。", [memory()], "message_2");
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]).toMatchObject({ type: "conflict", conflictWithId: "mem_1" });
    expect(result.creates[0].content).toContain("冲突待确认");
  });

  it("detects can-versus-cannot conflicts without dropping the shared action topic", () => {
    const confirmed = memory({ content: "系统不能自动发布版本" });
    const result = planMemoryUpdates("系统能自动发布版本。", [confirmed], "message_2");
    expect(result.creates[0]).toMatchObject({ type: "conflict", conflictWithId: "mem_1" });
  });

  it("records a conflict alongside other candidate memories without changing memory extraction", () => {
    const content = "以后允许 AI 自动修改正式产品基线。目标是本月完成上线。";
    const memoryPlan = planMemoryUpdates(content, [memory()], "message_2");
    expect(memoryPlan.creates.map((item) => item.type)).toEqual(["conflict", "fact"]);
    expect(memoryPlan.blockingConflictIds).toEqual(["mem_1"]);
  });

  it("merges a repeated conflict into the existing conflict item", () => {
    const existingConflict = memory({
      id: "conflict_1",
      type: "conflict",
      status: "candidate",
      content: "冲突待确认：新说法“以后允许 AI 自动修改正式产品基线”与已确认记忆“AI 不能自动修改正式产品基线”不一致。",
      conflictWithId: "mem_1"
    });
    const result = planMemoryUpdates("以后允许 AI 自动修改正式产品基线。", [memory(), existingConflict], "message_2");
    expect(result.creates).toEqual([]);
    expect(result.merges).toEqual([{ memoryId: "conflict_1", sourceMessageId: "message_2" }]);
    expect(result.blockingConflictIds).toEqual(["conflict_1"]);
  });

  it("does not store an ordinary user question as product memory", () => {
    const result = planMemoryUpdates("我们当前关于正式基线修改的决策是什么？", [memory()], "message_2");
    expect(result).toEqual({ creates: [], merges: [], blockingConflictIds: [] });
  });

  it.each(["之前的纠正是什么？", "之前的结论不对吗？"])("keeps correction-like questions read-only: %s", (content) => {
    const result = planMemoryUpdates(content, [memory()], "message_2");
    expect(result).toEqual({ creates: [], merges: [], blockingConflictIds: [] });
  });

  it.each(["系统能不能自动发布版本", "系统可以自动发布吗", "系统能否自动发布版本", "系统可否自动发布版本"])("recognizes punctuation-free questions: %s", (content) => {
    const result = planMemoryUpdates(content, [memory({ content: "系统不能自动发布版本" })], "message_2");
    expect(result).toEqual({ creates: [], merges: [], blockingConflictIds: [] });
  });
});

describe("context assembly", () => {
  it("keeps approved constraints and decisions when optional context exceeds the budget", () => {
    const state = {
      messages: Array.from({ length: 30 }, (_, index) => ({
        id: `message_${index}`,
        projectId: "project_1",
        role: "user" as const,
        author: "用户",
        content: "很长的历史讨论".repeat(100),
        citations: [],
        createdAt: `2026-08-26T00:00:${String(index).padStart(2, "0")}.000Z`
      })),
      memories: [memory()],
      sources: []
    } as Pick<StudioState, "messages" | "memories" | "sources">;
    const context = assembleProductContext(state, "project_1", baseline, "我们之前决定了什么？", 900);
    expect(context.text).toContain("所有正式变更必须人工审批");
    expect(context.text).toContain("经理 Agent 保留最终回答权");
    expect(context.text.indexOf("[正式产品基线]")).toBeLessThan(context.text.indexOf("[最近对话]"));
    expect(context.text.indexOf("[最近对话]")).toBeLessThan(context.text.indexOf("[已确认记忆]"));
  });

  it("exposes stable evidence IDs for messages, memories, sources, and baseline entries", () => {
    const state = {
      messages: [{ id: "msg_1", projectId: "project_1", role: "user" as const, author: "用户", content: "需要逐条审批", citations: [], createdAt: "2026-08-26T00:00:00.000Z" }],
      memories: [memory()],
      sources: [{ id: "src_1", projectId: "project_1", kind: "web" as const, title: "审批规范", status: "ready" as const, excerpt: "所有变更需要审批", size: 1, createdAt: "2026-08-26T00:00:00.000Z" }]
    } as Pick<StudioState, "messages" | "memories" | "sources">;

    const context = assembleProductContext(state, "project_1", baseline, "审批", 12000, 3);

    expect(context.evidenceCatalog.map((item) => item.id)).toEqual(expect.arrayContaining([
      "message:msg_1", "memory:mem_1", "source:src_1", "baseline:v3:requirements:0"
    ]));
    expect(context.text).toContain("[message:msg_1]");
  });
});

describe("memory version transitions", () => {
  it("never restores a superseded version", () => {
    expect(() => assertMemoryTransition(memory({ status: "superseded" }), "restore")).toThrow("不能恢复");
  });

  it("restores only forgotten versions", () => {
    expect(() => assertMemoryTransition(memory({ status: "confirmed" }), "restore")).toThrow("只有已遗忘");
    expect(() => assertMemoryTransition(memory({ status: "forgotten" }), "restore")).not.toThrow();
  });

  it("requires correction to resolve conflicts", () => {
    expect(() => assertMemoryTransition(memory({ type: "conflict", status: "candidate" }), "confirm")).toThrow("冲突项不能直接确认");
  });
});
