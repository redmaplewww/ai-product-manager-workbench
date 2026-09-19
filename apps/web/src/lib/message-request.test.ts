import { describe, expect, it, vi } from "vitest";
import { postProjectMessage } from "./message-request";

describe("postProjectMessage", () => {
  it("reports network failures without throwing", async () => {
    const result = await postProjectMessage(vi.fn().mockRejectedValue(new Error("offline")), "prj_1", "继续整理需求");
    expect(result).toEqual({ ok: false, error: "网络请求失败，请检查服务连接后重试。" });
  });
});
