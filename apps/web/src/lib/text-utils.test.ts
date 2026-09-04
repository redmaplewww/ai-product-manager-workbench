import { describe, expect, it } from "vitest";
import { comparableText } from "./text-utils";

describe("comparableText", () => {
  it("normalizes case, whitespace and punctuation in one shared helper", () => {
    expect(comparableText("A / B")).toBe(comparableText("a-b"));
  });
});
