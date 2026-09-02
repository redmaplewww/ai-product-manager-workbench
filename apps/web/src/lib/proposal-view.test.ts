import { describe, expect, it } from "vitest";
import { proposalChangeKey } from "./proposal-view";

describe("proposalChangeKey", () => {
  it("keeps repeated paths unique", () => {
    expect(proposalChangeKey("prop_1", "/requirements/-", 0)).not.toBe(proposalChangeKey("prop_1", "/requirements/-", 1));
  });
});
