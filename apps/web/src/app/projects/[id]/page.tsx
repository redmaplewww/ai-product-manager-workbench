import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readState } from "@/lib/store";
import { Workspace } from "@/components/workspace";

export const dynamic = "force-dynamic";
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  const { id } = await params; const state = await readState(); const project = state.projects.find((item) => item.id === id); if (!project) notFound();
  const snapshot = {
    project, baseline: state.artifactVersions.filter((item) => item.projectId === id).sort((a,b) => b.version-a.version)[0],
    messages: state.messages.filter((item) => item.projectId === id), proposals: state.proposals.filter((item) => item.projectId === id),
    memories: state.memories.filter((item) => item.projectId === id), sources: state.sources.filter((item) => item.projectId === id), runs: state.runs.filter((item) => item.projectId === id), models: state.models
  };
  return <Workspace initial={snapshot} user={{ name: user.name, role: user.role }} />;
}
