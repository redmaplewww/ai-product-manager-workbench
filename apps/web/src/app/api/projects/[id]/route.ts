import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { readState } from "@/lib/store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const state = await readState();
    const project = state.projects.find((item) => item.id === id);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    return NextResponse.json({
      project,
      baseline: state.artifactVersions.filter((item) => item.projectId === id).sort((a, b) => b.version - a.version)[0],
      messages: state.messages.filter((item) => item.projectId === id),
      proposals: state.proposals.filter((item) => item.projectId === id),
      memories: state.memories.filter((item) => item.projectId === id),
      sources: state.sources.filter((item) => item.projectId === id),
      runs: state.runs.filter((item) => item.projectId === id),
      models: state.models
    });
  } catch (error) { return apiError(error); }
}
