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
    const user = await requireRole(["admin", "editor"]);
    const input = z.object({ action: z.enum(["accept", "reject"]), selectedPaths: z.array(z.string()).optional() }).parse(await request.json());
    const { id: proposalId } = await context.params;
    const result = await updateState((state) => {
      const proposal = state.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
      const project = state.projects.find((item) => item.id === proposal.projectId)!;
      if (proposal.status !== "pending") throw new Error("提案已处理");
      if (input.action === "reject") {
        proposal.status = "rejected";
        proposal.reviewedAt = now();
        project.pendingProposals--;
        return { proposal, conflict: false as const };
      }
      if (proposal.baseVersion !== project.baselineVersion) {
        proposal.status = "stale";
        proposal.reviewedAt = now();
        project.pendingProposals = Math.max(0, project.pendingProposals - 1);
        state.auditEvents.unshift({
          id: id("audit"),
          actorId: user.id,
          action: "proposal.stale",
          target: proposal.id,
          detail: `提案基于 v${proposal.baseVersion}，当前基线为 v${project.baselineVersion}`,
          createdAt: now()
        });
        return { proposal, conflict: true as const };
      }
      const current = state.artifactVersions.find((item) => item.projectId === project.id && item.version === project.baselineVersion)!;
      const baseline = structuredClone(current.baseline);
      for (const change of proposal.changes) {
        if (input.selectedPaths && !input.selectedPaths.includes(change.path)) continue;
        const key = change.path.split("/")[1] as keyof typeof baseline;
        const target = baseline[key];
        if (Array.isArray(target)) (target as unknown[]).push(change.after);
        else if (typeof change.after === "string") (baseline as unknown as Record<string, unknown>)[key] = change.after;
      }
      project.baselineVersion += 1; project.pendingProposals -= 1; project.updatedAt = now();
      proposal.status = "accepted"; proposal.reviewedAt = now();
      state.artifactVersions.push({ id: id("av"), projectId: project.id, version: project.baselineVersion, baseline, createdAt: now(), createdBy: user.id });
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "proposal.accepted", target: proposal.id, detail: `创建基线 v${project.baselineVersion}`, createdAt: now() });
      return { proposal, conflict: false as const };
    });
    if (result.conflict) {
      return NextResponse.json(
        { error: "基线版本已变化，请重新生成差异", proposal: result.proposal },
        { status: 409 }
      );
    }
    return NextResponse.json({ proposal: result.proposal });
  } catch (error) { return apiError(error); }
}
