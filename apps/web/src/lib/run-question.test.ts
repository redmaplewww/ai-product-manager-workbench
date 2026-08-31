import { describe, expect, it } from "vitest";
import { questionForRun } from "./run-question";

describe("questionForRun", () => {
  it("finds the user question immediately before a run's assistant response", () => {
    expect(questionForRun([
      { id: "msg_1", role: "user", content: "请分析多智能体编排" },
      { id: "msg_2", role: "assistant", content: "分析结果", runId: "run_1" }
    ], "run_1")).toBe("请分析多智能体编排");
  });
});
