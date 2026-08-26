import { NextResponse } from "next/server";
import { createProjectInputSchema } from "@pm-studio/core";
import { apiError } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { readState, updateState } from "@/lib/store";
import { demoBaseline } from "@/lib/seed";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";

export async function GET() {
  try { await requireUser(); return NextResponse.json({ projects: (await readState()).projects }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireRole(["admin", "editor"]);
    const input = createProjectInputSchema.parse(await request.json());
    const project = await updateState((state) => {
      const timestamp = now();
      const project = { id: id("prj"), name: input.name, description: input.description, stage: "discovery" as const, language: "zh-CN", baselineVersion: 1, pendingProposals: 0, openQuestions: 1, createdAt: timestamp, updatedAt: timestamp };
      state.projects.unshift(project);
      state.artifactVersions.push({ id: id("av"), projectId: project.id, version: 1, baseline: { ...structuredClone(demoBaseline), summary: input.description, openQuestions: ["这个产品首先为谁解决什么问题？"] }, createdAt: timestamp, createdBy: user.id });
      state.auditEvents.unshift({ id: id("audit"), actorId: user.id, action: "project.created", target: project.id, detail: input.name, createdAt: timestamp });
      return project;
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return apiError(error); }
}
