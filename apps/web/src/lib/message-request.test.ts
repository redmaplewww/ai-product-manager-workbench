import { describe, expect, it } from "vitest";
import { postProjectMessage } from "./message-request";

describe("postProjectMessage", () => {
  it("returns a displayable error when the browser request is rejected", async () => {
    const result = await postProjectMessage(
      async () => { throw new TypeError("Failed to fetch"); },
      "prj_pmstudio",
      "分析风险",
      "explore"
    );

    expect(result).toEqual({ ok: false, error: "网络请求失败，请检查服务连接后重试。" });
  });
});
