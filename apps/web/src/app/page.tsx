import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readState } from "@/lib/store";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await currentUser(); if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  const state = await readState();
  return <Dashboard user={{ name: user.name, role: user.role }} projects={state.projects} pendingEvolution={state.evolutionProposals.filter((item) => item.status === "passed").length} />;
}
