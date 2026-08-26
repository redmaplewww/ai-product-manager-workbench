import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return <main className="login-shell">
    <section className="login-brand">
      <div className="brand-mark">PM</div>
      <div><h1>PM Studio</h1><p>持续对话，形成可追溯的产品共识。</p></div>
      <div className="login-points"><span>结构化产品基线</span><span>专家协作与独立评审</span><span>审批后才写入正式资产</span></div>
    </section>
    <LoginForm />
  </main>;
}
