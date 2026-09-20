import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { updateState } from "@/lib/store";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireRole(["admin", "editor"]);
    const { id: projectId, sourceId } = await context.params;
    const removed = await updateState((state) => {
      const index = state.sources.findIndex((item) => item.id === sourceId && item.projectId === projectId);
      if (index < 0) throw new Error("SOURCE_NOT_FOUND");
      const [removed] = state.sources.splice(index, 1);
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "source.deleted", target: sourceId, detail: removed.title.slice(0, 200), createdAt: now() });
      return removed;
    });
    return NextResponse.json({ removed: removed.id });
  } catch (error) { return apiError(error); }
}
