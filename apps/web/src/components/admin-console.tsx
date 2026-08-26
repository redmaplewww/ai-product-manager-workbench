"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { StudioState } from "@pm-studio/core";

type AdminData = Pick<StudioState, "users" | "models" | "evolutionProposals">;
export function AdminConsole({ initial }: { initial: AdminData }) {
  const [data, setData] = useState(initial); const [notice, setNotice] = useState("");
  async function updateModel(modelId: string, enabled: boolean) {
    setNotice(""); const response = await fetch("/api/admin/models", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: modelId, enabled }) });
    const body = await response.json(); if (!response.ok) { setNotice(body.error || "模型配置更新失败"); return; }
    setData((current) => ({ ...current, models: current.models.map((model) => model.id === modelId ? body.model : model) }));
  }
  async function evolve(proposalId: string, action: "publish"|"reject"|"rollback") {
    setNotice(""); const response = await fetch(`/api/admin/evolution/${proposalId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json(); if (!response.ok) { setNotice(body.error || "自进化操作失败"); return; }
    setData((current) => ({ ...current, evolutionProposals: current.evolutionProposals.map((proposal) => proposal.id === proposalId ? body.proposal : proposal) }));
  }
  return <div className="admin-page">
    <header className="workspace-header"><Link href="/" className="icon-button"><ArrowLeft size={18}/></Link><div className="workspace-title"><h1>系统管理</h1><span>单组织私有工作区</span></div><div className="header-status"><ShieldCheck size={15}/>管理员</div></header>
    <main className="admin-content">{notice && <p className="context-notice" role="alert">{notice}</p>}
      <div className="admin-heading"><p className="eyebrow">访问与运行策略</p><h1>团队与 AI 配置</h1></div>
      <section className="admin-section"><div className="admin-section-title"><h2>成员</h2><span>{data.users.length} 名</span></div><div className="admin-table">{data.users.map((user) => <div className="admin-row" key={user.id}><div><strong>{user.name}</strong><small>@{user.username}</small></div><span className="role-pill light">{user.role}</span><span className={user.mustChangePassword ? "state-warning" : "state-ready"}>{user.mustChangePassword ? "待修改临时密码" : "已启用"}</span></div>)}</div></section>
      <section className="admin-section"><div className="admin-section-title"><h2>模型路由</h2><span>密钥来自环境变量</span></div><div className="admin-table">{data.models.map((model) => <label className="admin-row model-row" key={model.id}><div><strong>{model.role}</strong><small>{model.provider} · {model.model}</small></div><span className={model.configured ? "state-ready" : "state-warning"}>{model.configured ? "凭据就绪" : "Demo 回退"}</span><input type="checkbox" checked={model.enabled} onChange={(event) => updateModel(model.id, event.target.checked)} aria-label={`启用 ${model.role}`}/></label>)}</div></section>
      <section className="admin-section"><div className="admin-section-title"><h2>自进化候选</h2><span>固定评测门槛</span></div>{data.evolutionProposals.map((proposal) => <div className="evolution-row" key={proposal.id}><div className="evolution-main"><span className={`proposal-status ${proposal.status}`}>{proposal.status}</span><h3>{proposal.title}</h3><p>{proposal.changeSummary}</p></div><div className="eval-metrics"><span>基线 <b>{proposal.baselineScore.toFixed(2)}</b></span><span>候选 <b>{proposal.candidateScore.toFixed(2)}</b></span><span>用例 <b>{proposal.evaluatedCases}</b></span><span>越权 <b>{proposal.unauthorizedActions}</b></span></div><div className="evolution-actions">{proposal.status === "passed" && <><button className="secondary-button danger" onClick={() => evolve(proposal.id,"reject")}><X size={15}/>拒绝</button><button className="primary-button compact" onClick={() => evolve(proposal.id,"publish")}><Check size={15}/>发布</button></>}{proposal.status === "published" && <button className="secondary-button" onClick={() => evolve(proposal.id,"rollback")}><RotateCcw size={15}/>回滚</button>}</div></div>)}</section>
    </main>
  </div>;
}
