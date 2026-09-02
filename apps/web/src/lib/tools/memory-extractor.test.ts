import { describe, expect, it } from "vitest";
import { extractMemory } from "./memory-extractor";

describe("memory extractor tool", () => {
  it("preserves the existing memory policy while exposing a tool boundary", () => {
    const result = extractMemory({
      content: "必须支持逐条审批。请分析一下具体流程。",
      memories: [],
      sourceMessageId: "message_1"
    });

    expect(result.creates).toEqual([{
      type: "constraint",
      content: "必须支持逐条审批",
      confidence: 0.84
    }]);
    expect(result.merges).toEqual([]);
    expect(result.blockingConflictIds).toEqual([]);
  });
});
