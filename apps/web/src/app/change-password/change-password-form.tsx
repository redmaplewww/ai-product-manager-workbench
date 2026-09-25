"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { apiUrl, BASE_PATH } from "@/lib/app-path";

export function ChangePasswordForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("newPassword") || "");
    if (newPassword !== data.get("confirmation")) { setError("两次输入的新密码不一致"); setBusy(false); return; }
    const response = await fetch(apiUrl("/api/auth/password"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "密码修改失败"); setBusy(false); return; }
    location.href = `${BASE_PATH}/`;
  }
  return <section className="login-panel">
    <div className="login-heading"><KeyRound size={22}/><div><h2>设置正式密码</h2><p>首次登录必须替换管理员创建的临时密码</p></div></div>
    <form onSubmit={submit} className="form-stack" method="post" action={apiUrl("/api/auth/password")}>
      <label>当前临时密码<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>新密码<input name="newPassword" type="password" minLength={12} autoComplete="new-password" required /></label>
      <label>再次输入新密码<input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "正在更新..." : "更新密码并进入工作区"}<ArrowRight size={17}/></button>
    </form>
  </section>;
}
