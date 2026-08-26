import { hash, verify } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";
import { updateState } from "@/lib/store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = z.object({
      currentPassword: z.string().min(8),
      newPassword: z.string().min(12).max(200)
    }).parse(await request.json());
    if (input.currentPassword === input.newPassword) throw new Error("新密码不能与临时密码相同");
    if (!user.passwordHash || !(await verify(user.passwordHash, input.currentPassword))) throw new Error("当前密码错误");
    const passwordHash = await hash(input.newPassword, { algorithm: 2 });
    await updateState((state) => {
      const target = state.users.find((item) => item.id === user.id);
      if (!target) throw new Error("USER_NOT_FOUND");
      target.passwordHash = passwordHash;
      target.mustChangePassword = false;
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "auth.password_changed", target: user.id, detail: "Password changed", createdAt: now() });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
