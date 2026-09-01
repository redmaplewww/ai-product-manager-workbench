import { describe, expect, it } from "vitest";
import { getAgent } from "./catalog";

describe("agent catalog contracts", () => {
  it("declares the existing baseline categories for PM proposal output", () => {
    const prompt = getAgent("pm-synthesizer")?.prompt || "";
    expect(prompt).toContain("audience、goals、metrics、scope、nonGoals、requirements、risks、decisions、openQuestions");
  });

  it("requires every expert conclusion to separate solved and remaining work", () => {
    expect(getAgent("requirements-analyst")?.prompt).toContain("solved");
    expect(getAgent("requirements-analyst")?.prompt).toContain("remaining");
    expect(getAgent("exploration-planner")?.prompt).toContain("basedOnGap");
  });
});
