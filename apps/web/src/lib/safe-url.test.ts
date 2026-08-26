import { describe, expect, it } from "vitest";
import { assertSafePublicUrl } from "./safe-url";

describe("safe public URL", () => {
  it("rejects loopback and private addresses", async () => {
    await expect(assertSafePublicUrl("http://127.0.0.1/admin")).rejects.toThrow(/私有网络/);
    await expect(assertSafePublicUrl("http://192.168.1.10/")).rejects.toThrow(/私有网络/);
  });
  it("rejects non-http protocols and embedded credentials", async () => {
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toThrow(/HTTP/);
    await expect(assertSafePublicUrl("https://user:pass@example.com/")).rejects.toThrow(/认证信息/);
  });
});
