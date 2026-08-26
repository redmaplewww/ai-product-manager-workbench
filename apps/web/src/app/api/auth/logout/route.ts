import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  assertSameOrigin(request);
  await clearSession();
  return NextResponse.json({ ok: true });
}
