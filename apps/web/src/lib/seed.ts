import type { StudioState, ProductBaseline } from "@pm-studio/core";
import { hash } from "@node-rs/argon2";
import "./env";

const createdAt = "2026-08-26T09:00:00.000Z";

export const demoBaseline: ProductBaseline = {
  summary: "为内部产品团队提供持续对话、证据归档、版本审批和工作拆分的一体化 AI 产品经理工作台。",
  problem: "产品讨论分散在聊天和文档中，需求依据、决策历史与交付拆分容易失真。",
  audience: ["产品负责人", "产品经理", "研发与设计评审成员"],
  goals: ["让产品共识沉淀为可审批基线", "缩短从讨论到可执行规划的时间", "保留每项结论的证据和变更历史"],
  metrics: ["提案一次通过率 >= 60%", "关键需求来源覆盖率 >= 90%", "冲突发现率逐月提升"],
  scope: ["持续对话", "产品基线", "结构化变更审批", "多 Agent 规划", "分层记忆", "文件与网页来源"],
  nonGoals: ["自动修改外部项目管理工具", "自动提交代码", "多租户计费"],
  requirements: ["所有正式资产变更必须经产品编辑批准", "AI 结论必须关联对话或知识来源", "用户纠正不得被旧记忆覆盖"],
  risks: ["错误记忆长期放大", "模型供应商能力差异", "外部资料中的提示注入"],
  decisions: ["统一 PM 对外，专家在后台协作", "正式基线与候选记忆分离", "使用多供应商能力路由"],
  openQuestions: ["团队最常用的评审节奏是什么？", "首批真实项目应覆盖哪些产品类型？"],
  outcomes: [{
    id: "outcome_alignment", title: "产品共识可追溯", metric: "基线变更 100% 有来源和审批记录", capabilities: [{
      id: "cap_baseline", title: "持续产品基线", outcomeId: "outcome_alignment", epics: [{
        id: "epic_approval", title: "候选变更与审批", capabilityId: "cap_baseline", workItems: [{
          id: "wi_diff", title: "结构化 Diff 与乐观锁审批", type: "feature", priority: "P0", ownerRole: "产品与平台工程", estimate: "M",
          status: "ready", dependencies: [], risks: ["并发审批造成版本冲突"], acceptanceCriteria: ["过期提案不能覆盖新基线", "支持逐项选择变更"]
        }]
      }]
    }]
  }]
};

export async function createSeedState(): Promise<StudioState> {
  const passwordHash = await hash(process.env.PM_STUDIO_BOOTSTRAP_PASSWORD || "Admin123!", { algorithm: 2 });
  return {
    users: [
      { id: "usr_admin", name: "系统管理员", username: "admin", role: "admin", passwordHash, mustChangePassword: false, createdAt },
      { id: "usr_editor", name: "产品编辑", username: "editor", role: "editor", passwordHash, mustChangePassword: false, createdAt },
      { id: "usr_reviewer", name: "评审成员", username: "reviewer", role: "reviewer", passwordHash, mustChangePassword: false, createdAt }
    ],
    projects: [{ id: "prj_pmstudio", name: "AI 产品经理工作台", description: "把持续讨论转化为可追溯产品基线和执行计划", stage: "planning", language: "zh-CN", baselineVersion: 3, pendingProposals: 1, openQuestions: 2, createdAt, updatedAt: "2026-08-26T11:42:00.000Z" }],
    messages: [
      { id: "msg_1", projectId: "prj_pmstudio", role: "user", author: "产品负责人", content: "我们需要一个持续理解产品的 AI 产品经理，不要每轮都从头开始。", citations: [], createdAt: "2026-08-26T10:00:00.000Z" },
      { id: "msg_2", projectId: "prj_pmstudio", role: "assistant", author: "AI 产品经理", content: "我已将“跨会话保持产品理解”识别为核心约束。建议把对话历史、已确认产品事实和提示词流程分层保存，并且任何正式基线变更都先生成待审批提案。当前仍需确认：候选记忆是否允许低权重参与后续讨论？", citations: [], runId: "run_seed", createdAt: "2026-08-26T10:01:00.000Z" }
    ],
    runs: [{ id: "run_seed", projectId: "prj_pmstudio", status: "completed", costUsd: 0.018, durationMs: 6840, demoMode: true, createdAt: "2026-08-26T10:00:01.000Z", completedAt: "2026-08-26T10:00:08.000Z", steps: [
      { id: "step_1", agent: "需求分析", provider: "OpenAI", model: "gpt-5.6-terra", status: "completed", summary: "识别持续记忆和审批边界", durationMs: 2140, retries: 0, startedAt: "2026-08-26T10:00:01.000Z" },
      { id: "step_2", agent: "批判评审", provider: "DeepSeek", model: "deepseek-v4-pro", status: "completed", summary: "发现候选记忆污染正式基线的风险", durationMs: 2810, retries: 0, startedAt: "2026-08-26T10:00:03.000Z" },
      { id: "step_3", agent: "PM 综合", provider: "OpenAI", model: "gpt-5.6-terra", status: "completed", summary: "形成分层记忆建议与澄清问题", durationMs: 1890, retries: 0, startedAt: "2026-08-26T10:00:06.000Z" }
    ] }],
    proposals: [{ id: "prop_seed", projectId: "prj_pmstudio", title: "补充候选记忆使用规则", rationale: "防止未确认信息直接改变正式规划", baseVersion: 3, status: "pending", createdByRunId: "run_seed", createdAt: "2026-08-26T10:01:00.000Z", changes: [
      { path: "/requirements/-", after: "候选记忆可以低权重参与讨论，但不能直接驱动正式资产", selected: true },
      { path: "/risks/-", after: "候选记忆被重复引用后可能形成错误共识", selected: true }
    ] }],
    memories: [
      { id: "mem_1", projectId: "prj_pmstudio", type: "constraint", content: "AI 不能自动修改正式产品基线", confidence: 1, status: "confirmed", sourceMessageIds: ["msg_1"], createdAt, updatedAt: createdAt },
      { id: "mem_2", projectId: "prj_pmstudio", type: "preference", content: "候选记忆应低权重参与后续讨论", confidence: 0.78, status: "candidate", sourceMessageIds: ["msg_2"], createdAt, updatedAt: createdAt }
    ],
    sources: [
      { id: "src_1", projectId: "prj_pmstudio", kind: "web", title: "Agents SDK 编排说明", url: "https://developers.openai.com/api/docs/guides/agents/orchestration", status: "ready", excerpt: "经理 Agent 保持最终回答权，专家作为边界清晰的能力。", size: 18420, createdAt },
      { id: "src_2", projectId: "prj_pmstudio", kind: "file", title: "内部产品访谈纪要.pdf", mimeType: "application/pdf", status: "ready", excerpt: "团队最担心 AI 忘记前序决策，或把探索性讨论当成正式需求。", size: 284210, createdAt }
    ],
    artifactVersions: [{ id: "av_3", projectId: "prj_pmstudio", version: 3, baseline: demoBaseline, createdAt, createdBy: "usr_admin" }],
    models: [
      { id: "mdl_primary", role: "PM 与规划", provider: "openai", model: process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-terra", enabled: true, configured: Boolean(process.env.OPENAI_API_KEY), capabilities: ["structured", "tools", "stream", "vision", "reasoning"] },
      { id: "mdl_deep", role: "复杂任务升级", provider: "openai", model: process.env.OPENAI_DEEP_MODEL || "gpt-5.6-sol", enabled: true, configured: Boolean(process.env.OPENAI_API_KEY), capabilities: ["structured", "tools", "stream", "vision", "reasoning"] },
      { id: "mdl_fast", role: "提取与记忆", provider: "deepseek", model: process.env.DEEPSEEK_FAST_MODEL || "deepseek-v4-flash", enabled: true, configured: Boolean(process.env.DEEPSEEK_API_KEY), capabilities: ["structured", "stream", "reasoning"] },
      { id: "mdl_review", role: "独立批判评审", provider: "deepseek", model: process.env.DEEPSEEK_REVIEW_MODEL || "deepseek-v4-pro", enabled: true, configured: Boolean(process.env.DEEPSEEK_API_KEY), capabilities: ["structured", "stream", "reasoning"] }
    ],
    evolutionProposals: [{ id: "evo_1", title: "增强冲突识别提示", status: "passed", promptArea: "critical-reviewer", baselineScore: 0.78, candidateScore: 0.84, schemaValid: true, unauthorizedActions: 0, evaluatedCases: 32, changeSummary: "要求评审 Agent 明确区分事实冲突、范围变化和措辞差异。", createdAt }],
    auditEvents: [{ id: "audit_1", actorId: "usr_admin", action: "project.created", target: "prj_pmstudio", detail: "创建示例项目", createdAt }]
  };
}
