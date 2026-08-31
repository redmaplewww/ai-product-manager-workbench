import { describe, expect, it } from "vitest";
import { baselineSchema, sendMessageInputSchema } from "./schemas";

describe("domain schemas", () => {
  it("rejects an empty message", () => expect(sendMessageInputSchema.safeParse({ content: "  " }).success).toBe(false));
  it("requires an explicit workflow mode for a message", () => {
    expect(sendMessageInputSchema.safeParse({ content: "分析当前风险" }).success).toBe(false);
  });
  it("accepts both supported workflow modes", () => {
    expect(sendMessageInputSchema.safeParse({ content: "分析当前风险", workflowMode: "structured" }).success).toBe(true);
    expect(sendMessageInputSchema.safeParse({ content: "分析当前风险", workflowMode: "explore" }).success).toBe(true);
  });
  it("requires the complete planning hierarchy", () => {
    expect(baselineSchema.safeParse({ summary: "x" }).success).toBe(false);
  });
});
