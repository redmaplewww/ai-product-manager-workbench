import { describe, expect, it } from "vitest";
import { proposalChangeKey } from "./proposal-view";

describe("proposal change rendering", () => {
  it("creates unique keys for multiple changes targeting the same baseline path", () => {
    expect(proposalChangeKey("prop_1", "/requirements/-", 0)).not.toBe(proposalChangeKey("prop_1", "/requirements/-", 1));
  });
});
