import { describe, expect, it } from "vitest";
import { sourceUrlInputSchema } from "./source-request";

describe("sourceUrlInputSchema", () => {
  it("rejects malformed URL request bodies", () => {
    expect(sourceUrlInputSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(sourceUrlInputSchema.safeParse({ url: "https://example.com/spec", title: "规范" }).success).toBe(true);
  });
});
