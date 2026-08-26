import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
import { updateState, readState } from "@/lib/store";
import { id, now } from "@/lib/ids";

export async function GET() {
  try { await requireRole(["admin"]); return NextResponse.json({ models: (await readState()).models }); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireRole(["admin"]);
    const input = z.object({ id: z.string(), enabled: z.boolean().optional(), model: z.string().trim().min(2).max(100).optional() }).parse(await request.json());
    const model = await updateState((state) => {
      const item = state.models.find((entry) => entry.id === input.id);
      if (!item) throw new Error("MODEL_NOT_FOUND");
      if (input.enabled !== undefined) item.enabled = input.enabled;
      if (input.model) item.model = input.model;
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "model.updated", target: item.id, detail: `${item.provider}:${item.model} enabled=${item.enabled}`, createdAt: now() });
      return item;
    });
    return NextResponse.json({ model });
  } catch (error) { return apiError(error); }
}
