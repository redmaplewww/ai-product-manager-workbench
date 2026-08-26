import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readState } from "@/lib/store";
import { AdminConsole } from "@/components/admin-console";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (user.role !== "admin") redirect("/");
  const state = await readState();
  return <AdminConsole initial={{ users: state.users, models: state.models, evolutionProposals: state.evolutionProposals }} />;
}
