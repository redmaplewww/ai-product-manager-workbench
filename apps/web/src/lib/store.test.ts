import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Vitest 4 types omit the virtual-module options supported at runtime.
vi.mock("server-only", () => ({}), { virtual: true });

import { shouldBootstrapState } from "./store";

describe("local state bootstrap", () => {
  it("bootstraps only when the state file is absent", () => {
    expect(shouldBootstrapState({ code: "ENOENT" })).toBe(true);
    expect(shouldBootstrapState(new SyntaxError("invalid json"))).toBe(false);
    expect(shouldBootstrapState({ code: "EACCES" })).toBe(false);
  });
});
