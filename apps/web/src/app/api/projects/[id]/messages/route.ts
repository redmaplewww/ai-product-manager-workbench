import { NextResponse } from "next/server";
import { sendMessageInputSchema } from "@pm-studio/core";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { updateState } from "@/lib/store";
import { executeTurn } from "@/lib/orchestrator";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireRole(["admin", "editor", "reviewer"]);
    const input = sendMessageInputSchema.parse(await request.json());
    const { id } = await context.params;
    const result = await updateState((state) => executeTurn(state, id, input.content, user.name));
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
