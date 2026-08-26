import { NextResponse } from "next/server";
import { z } from "zod";
import { assertMemoryTransition } from "@pm-studio/core";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { updateState } from "@/lib/store";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireRole(["admin", "editor"]);
    const input = z.object({ action: z.enum(["confirm", "forget", "correct", "restore"]), content: z.string().min(1).optional() }).parse(await request.json());
    const { id: memoryId } = await context.params;
    const memory = await updateState((state) => {
      const item = state.memories.find((entry) => entry.id === memoryId);
      if (!item) throw new Error("MEMORY_NOT_FOUND");
      assertMemoryTransition(item, input.action);
      if (input.action === "correct") {
        if (!input.content) throw new Error("纠正内容不能为空");
        const previous = item.type === "conflict" && item.conflictWithId
          ? state.memories.find((entry) => entry.id === item.conflictWithId)
          : item;
        if (!previous) throw new Error("CONFLICT_TARGET_NOT_FOUND");
        const changedAt = now();
        previous.status = "superseded";
        previous.updatedAt = changedAt;
        item.status = "superseded";
        item.updatedAt = changedAt;
        const replacement = {
          ...previous,
          id: id("mem"),
          content: input.content,
          status: "confirmed" as const,
          sourceMessageIds: [...new Set([...previous.sourceMessageIds, ...item.sourceMessageIds])],
          supersedesId: previous.id,
          conflictWithId: undefined,
          createdAt: changedAt,
          updatedAt: changedAt
        };
        state.memories.unshift(replacement);
        state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "memory.correct", target: replacement.id, detail: `supersedes ${previous.id}`, createdAt: changedAt });
        return replacement;
      }
      item.status = input.action === "confirm" || input.action === "restore" ? "confirmed" : "forgotten";
      item.updatedAt = now();
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: `memory.${input.action}`, target: item.id, detail: `${item.type} memory status updated`, createdAt: now() });
      return item;
    });
    return NextResponse.json({ memory });
  } catch (error) { return apiError(error); }
}
