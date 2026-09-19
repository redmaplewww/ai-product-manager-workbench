import { describe, expect, it } from "vitest";
import { packetItemIds } from "./agent-packet";

describe("packetItemIds", () => {
  it("collects all packet item IDs without callers knowing packet internals", () => {
    expect(packetItemIds({ assertions: [{ id: "a" }], clarificationQuestions: [{ id: "q" }], issues: [{ id: "i" }] } as never)).toEqual(["a", "q", "i"]);
  });
});
