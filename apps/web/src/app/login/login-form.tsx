"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "登录失败"); setBusy(false); return; }
    location.href = body.mustChangePassword ? "/change-password" : "/";
  }
  return <section className="login-panel">
    <div className="login-heading"><LockKeyhole size={22}/><div><h2>团队登录</h2><p>使用管理员创建的账号访问工作区</p></div></div>
    <form onSubmit={submit} className="form-stack" method="post" action="/api/auth/login">
      <label>用户名<input name="username" defaultValue="admin" autoComplete="username" /></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "验证中..." : "进入工作区"}<ArrowRight size={17}/></button>
    </form>
    <p className="demo-note">演示账号：admin / editor / reviewer，密码均为 Admin123!</p>
  </section>;
}
