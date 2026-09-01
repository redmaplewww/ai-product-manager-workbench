const agentIds: Record<string, string> = {
  "需求分析": "requirements-analyst",
  "领域分析": "domain-analyst",
  "交付规划": "delivery-planner",
  "批判评审": "critical-reviewer",
  "PM 综合": "pm-synthesizer",
  "探索规划": "exploration-planner"
};

function migrateResult(result: Record<string, any> | undefined) {
  if (!result) return undefined;
  if (Array.isArray(result.solved) && Array.isArray(result.remaining)) return result;
  const remaining = Array.isArray(result.gaps)
    ? result.gaps.map((gap: any, index: number) => typeof gap === "string"
      ? { key: `legacy-gap-${index + 1}`, question: gap, suggestedCapabilityIds: [] }
      : gap)
    : [];
  const { findings: _findings, gaps: _gaps, ...rest } = result;
  return { ...rest, solved: Array.isArray(result.findings) ? result.findings : [], remaining };
}

function migrateWave(wave: Record<string, any>): Record<string, any> {
  return { ...wave, actions: Array.isArray(wave.actions) ? wave.actions.map((action: Record<string, any>) => ({ ...action, result: migrateResult(action.result) })) : [] };
}

export function migrateLegacyRun(value: unknown): Record<string, any> {
  const run = value as Record<string, any>;
  if (Array.isArray(run.waves)) return { ...run, waves: run.waves.map((wave: Record<string, any>) => migrateWave(wave)) };
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const actions = steps.map((step, index) => ({
    id: step.id || `legacy_action_${index + 1}`,
    capabilityId: agentIds[step.agent] || `legacy:${step.agent || "unknown"}`,
    goal: `迁移旧版步骤：${step.agent || "未知能力"}`,
    status: step.status === "failed" ? "failed" : step.status === "queued" || step.status === "running" ? step.status : "succeeded",
    execution: {
      route: run.demoMode ? "fallback" : "primary",
      provider: step.provider,
      model: step.model,
      durationMs: step.durationMs || 0,
      retries: step.retries || 0
    },
    result: step.status === "failed" ? undefined : {
      summary: step.summary || "旧版步骤已完成",
      solved: step.summary ? [step.summary] : [],
      remaining: [],
      evidenceRefs: []
    },
    error: step.status === "failed" ? step.summary : undefined,
    startedAt: step.startedAt,
    completedAt: step.startedAt
  }));
  const { steps: _steps, demoMode: _demoMode, ...rest } = run;
  return {
    ...rest,
    workflowMode: run.workflowMode || "structured",
    todos: [],
    waves: [{ id: `legacy_wave_${run.id}`, index: 1, source: "workflow", summary: "迁移自旧版运行步骤", actions }]
  };
}

export function migrateStudioState(value: unknown) {
  const state = structuredClone(value as Record<string, any>);
  state.runs = Array.isArray(state.runs) ? state.runs.map((run: Record<string, any>) => {
    const migrated = migrateLegacyRun(run);
    if (migrated.userMessageId || !Array.isArray(state.messages)) return migrated;
    const responseIndex = state.messages.findIndex((message: Record<string, any>) => message.runId === migrated.id);
    for (let index = responseIndex - 1; index >= 0; index -= 1) {
      if (state.messages[index].role === "user") return { ...migrated, userMessageId: state.messages[index].id };
    }
    return migrated;
  }) : [];
  return state;
}
