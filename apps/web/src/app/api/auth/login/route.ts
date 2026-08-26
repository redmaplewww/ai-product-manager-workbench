import { verify } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { readState, updateState } from "@/lib/store";
import { id, now } from "@/lib/ids";
import { assertLoginAllowed, assertSameOrigin, clearLoginFailures, recordLoginFailure } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = z.object({ username: z.string().min(1), password: z.string().min(8) }).parse(await request.json());
    assertLoginAllowed(request, input.username);
    const state = await readState();
    const user = state.users.find((item) => item.username === input.username);
    if (!user?.passwordHash || !(await verify(user.passwordHash, input.password))) {
      recordLoginFailure(request, input.username);
      throw new Error("用户名或密码错误");
    }
    clearLoginFailures(request, input.username);
    await createSession(user.id);
    await updateState((draft) => draft.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "auth.login", target: user.id, detail: "登录成功", createdAt: now() }));
    return NextResponse.json({ user: { id: user.id, name: user.name, role: user.role }, mustChangePassword: user.mustChangePassword });
  } catch (error) { return apiError(error); }
}
