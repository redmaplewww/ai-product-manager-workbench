import { describe, expect, it } from "vitest";
import { getAgent, getExecutableTool } from "./catalog";

describe("agent catalog", () => {
  it("resolves registered structured capabilities", () => {
    expect(getAgent("requirements-analyst")?.name).toBe("需求分析");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("统一对外");
  });

  it("does not expose an unimplemented tool as executable", () => {
    expect(getExecutableTool("source-search")).toBeUndefined();
  });
});
