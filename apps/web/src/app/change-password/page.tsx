import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/");
  return <main className="login-shell">
    <section className="login-brand">
      <div className="brand-mark">PM</div>
      <div><h1>保护团队资产</h1><p>临时凭据只用于首次进入工作区。</p></div>
      <div className="login-points"><span>至少 12 个字符</span><span>使用 Argon2id 保存密码摘要</span><span>修改操作写入安全审计</span></div>
    </section>
    <ChangePasswordForm />
  </main>;
}
