"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BrainCircuit, CirclePlus, Clock3, FolderKanban, LogOut, Settings, ShieldCheck, Sparkles } from "lucide-react";
import type { Project } from "@pm-studio/core";
import { apiUrl, BASE_PATH } from "@/lib/app-path";

const stages = { discovery: "探索", definition: "定义", planning: "规划", delivery: "交付" };
export function Dashboard({ user, projects, pendingEvolution }: { user: { name: string; role: string }; projects: Project[]; pendingEvolution: number }) {
  const router = useRouter(); const [showCreate, setShowCreate] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function create(form: FormData) {
    setBusy(true); setError("");
    const response = await fetch(apiUrl("/api/projects"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) });
    if (response.ok) { const { project } = await response.json(); router.push(`/projects/${project.id}`); return; }
    const detail = (await response.json().catch(() => ({}))).error;
    setError(detail === "FORBIDDEN" ? "当前角色无权创建项目，需要管理员或产品编辑。" : detail || `创建失败（${response.status}），请重试`);
    setBusy(false);
  }
  async function logout() { await fetch(apiUrl("/api/auth/logout"), { method: "POST" }); location.href = `${BASE_PATH}/login`; }
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark small">PM</div><span>PM Studio</span></div><div className="top-actions"><span className="role-pill">{user.role}</span><span>{user.name}</span>{user.role === "admin" && <button className="icon-button" onClick={() => router.push("/admin")} title="系统管理"><Settings size={17}/></button>}<button className="icon-button" onClick={logout} title="退出登录"><LogOut size={17}/></button></div></header>
    <main className="dashboard">
      <div className="dashboard-title"><div><p className="eyebrow">产品工作区</p><h1>正在推进的产品</h1><p>对话、决策和规划都从项目开始。</p></div>{user.role !== "reviewer" && <button className="primary-button compact" onClick={() => setShowCreate(true)}><CirclePlus size={17}/>新建项目</button>}</div>
      <section className="metric-strip">
        <div><FolderKanban/><span>活跃项目<strong>{projects.length}</strong></span></div>
        <div><Clock3/><span>待审提案<strong>{projects.reduce((sum, item) => sum + item.pendingProposals, 0)}</strong></span></div>
        <div><BrainCircuit/><span>开放问题<strong>{projects.reduce((sum, item) => sum + item.openQuestions, 0)}</strong></span></div>
        <div><ShieldCheck/><span>待发布改进<strong>{pendingEvolution}</strong></span></div>
      </section>
      <section className="project-list"><div className="section-heading"><h2>项目</h2><span>{projects.length} 个</span></div>{projects.map((project) => <button key={project.id} className="project-row" onClick={() => router.push(`/projects/${project.id}`)}>
        <div className="project-icon"><Sparkles size={19}/></div><div className="project-main"><div><h3>{project.name}</h3><span className={`stage ${project.stage}`}>{stages[project.stage]}</span></div><p>{project.description}</p></div>
        <div className="project-stat"><span>基线</span><strong>v{project.baselineVersion}</strong></div><div className="project-stat alert"><span>待审</span><strong>{project.pendingProposals}</strong></div><ArrowUpRight className="row-arrow" size={18}/>
      </button>)}</section>
    </main>
    {showCreate && <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}><form className="modal" action={create} onMouseDown={(e) => e.stopPropagation()}><div><p className="eyebrow">新项目</p><h2>定义最初的产品意图</h2></div>{error && <p className="form-error" role="alert">{error}</p>}<label>项目名称<input name="name" required minLength={2} autoFocus /></label><label>一句话描述<textarea name="description" required minLength={4} rows={4}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>取消</button><button className="primary-button compact" disabled={busy}>{busy ? "创建中..." : "创建项目"}</button></div></form></div>}
  </div>;
}
