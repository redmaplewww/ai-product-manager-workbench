import { describe, expect, it } from "vitest";
import { getAgent, getExecutableTool } from "./catalog";

describe("agent catalog", () => {
  it("resolves the registered requirements analyst", () => {
    expect(getAgent("requirements-analyst")?.name).toBe("需求分析");
  });

  it("does not expose an unimplemented tool as executable", () => {
    expect(getExecutableTool("source-search")).toBeUndefined();
  });
});
