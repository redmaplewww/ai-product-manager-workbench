import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { updateState } from "@/lib/store";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireRole(["admin"]);
    const { action } = z.object({ action: z.enum(["publish", "reject", "rollback"]) }).parse(await request.json());
    const { id: proposalId } = await context.params;
    const proposal = await updateState((state) => {
      const item = state.evolutionProposals.find((entry) => entry.id === proposalId);
      if (!item) throw new Error("EVOLUTION_NOT_FOUND");
      if (action === "publish" && (!item.schemaValid || item.unauthorizedActions > 0 || item.candidateScore < item.baselineScore * 1.05)) throw new Error("候选版本未达到发布硬门槛");
      item.status = action === "publish" ? "published" : action === "rollback" ? "rolled_back" : "rejected";
      if (action === "publish") item.publishedAt = now();
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: `evolution.${action}`, target: item.id, detail: item.changeSummary, createdAt: now() });
      return item;
    });
    return NextResponse.json({ proposal });
  } catch (error) { return apiError(error); }
}
