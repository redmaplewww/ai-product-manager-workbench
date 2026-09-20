import type { EvidenceRef, MemoryItem, ProductBaseline, StudioState } from "./schemas";

export type TurnIntent = "question" | "correction" | "planning" | "constraint" | "decision" | "goal" | "risk" | "requirement";

export type MemoryDraft = Pick<MemoryItem, "type" | "content" | "confidence"> & {
  conflictWithId?: string;
};

export type MemoryUpdatePlan = {
  creates: MemoryDraft[];
  merges: Array<{ memoryId: string; sourceMessageId: string }>;
  blockingConflictIds: string[];
};

export type MemoryAction = "confirm" | "forget" | "correct" | "restore";

export type ProductContext = {
  text: string;
  evidenceCatalog: EvidenceRef[];
  citationIds: string[];
  counts: { recentMessages: number; confirmedMemories: number; candidateMemories: number; sources: number; conflicts: number };
};

const negativeTerms = /不能|不允许|禁止|不要|不得|不可以|严禁/u;
const positiveTerms = /允许|可以|可由|能够|能自动/u;
const punctuation = /[\s\p{P}\p{S}]+/gu;

export function normalizeMemoryText(value: string) {
  return value.toLowerCase().replace(punctuation, "").replace(/^(我们|以后|目前|当前|请注意)/u, "");
}

function topicText(value: string) {
  return normalizeMemoryText(value).replace(/不能|不允许|禁止|不要|不得|不可以|严禁|允许|可以|可由|能够|能(?=自动)/gu, "");
}

function grams(value: string) {
  const chars = [...value];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
}

function similarity(left: string, right: string) {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  return overlap / (a.size + b.size - overlap);
}

function isContradiction(left: string, right: string) {
  const oppositePolarity = (negativeTerms.test(left) && positiveTerms.test(right)) || (positiveTerms.test(left) && negativeTerms.test(right));
  return oppositePolarity && similarity(topicText(left), topicText(right)) >= 0.55;
}

function splitStatements(content: string) {
  return content
    .split(/(?<=[。！？?!；;\n])/u)
    .map((item) => item.trim().replace(/[。；;]+$/u, ""))
    .filter((item) => item.length >= 4)
    .slice(0, 4);
}

function isQuestion(content: string) {
  return /[?？]|怎么|咋|如何|为何|为什么|是否|能否|可否|能不能|要不要|请问|想知道|吗(?:[。！!]?$)|呢(?:[。！!]?$)/u.test(content);
}

export function classifyTurnIntent(content: string): TurnIntent {
  if (isQuestion(content)) return "question";
  if (/纠正|改为|不是.+而是|之前.+不对/u.test(content)) return "correction";
  if (/拆分|规划|路线图|优先级|里程碑|workitem|epic/u.test(content.toLowerCase())) return "planning";
  if (/风险|担心|隐患/u.test(content)) return "risk";
  if (/决定|确定|采用|选择/u.test(content)) return "decision";
  if (/目标|希望|指标/u.test(content)) return "goal";
  if (/必须|不能|禁止|不得|只允许/u.test(content)) return "constraint";
  return "requirement";
}

function inferMemoryType(statement: string): MemoryItem["type"] {
  const intent = classifyTurnIntent(statement);
  if (intent === "question") return "open_question";
  if (intent === "correction") return "fact";
  if (intent === "constraint") return "constraint";
  if (intent === "decision") return "decision";
  if (intent === "risk") return "risk";
  if (intent === "goal") return "fact";
  return "fact";
}

function isInstructionOnly(statement: string) {
  return /^(请|帮我|麻烦)?(分析|拆分|规划|总结|解释|列出|检查)/u.test(statement) && !/必须|不能|目标|风险|决定|用户|产品/u.test(statement);
}

export function planMemoryUpdates(content: string, memories: MemoryItem[], sourceMessageId: string): MemoryUpdatePlan {
  const active = memories.filter((item) => item.status === "candidate" || item.status === "confirmed");
  const creates: MemoryDraft[] = [];
  const merges: MemoryUpdatePlan["merges"] = [];
  const blockingConflictIds: string[] = [];

  for (const statement of splitStatements(content)) {
    if (isInstructionOnly(statement)) continue;
    if (isQuestion(statement) && !/^(待确认|开放问题|需要确认)[:：]?/u.test(statement)) continue;
    const normalized = normalizeMemoryText(statement);
    const duplicate = active.find((item) => {
      const existing = normalizeMemoryText(item.content);
      return existing === normalized || similarity(existing, normalized) >= 0.88;
    });
    if (duplicate) {
      if (!duplicate.sourceMessageIds.includes(sourceMessageId) && !merges.some((item) => item.memoryId === duplicate.id)) {
        merges.push({ memoryId: duplicate.id, sourceMessageId });
      }
      continue;
    }

    const conflict = active.find((item) => item.status === "confirmed" && item.type !== "open_question" && isContradiction(statement, item.content));
    if (conflict) {
      const existingConflict = active.find((item) => item.type === "conflict" && item.conflictWithId === conflict.id && normalizeMemoryText(item.content).includes(normalized));
      if (existingConflict) {
        blockingConflictIds.push(existingConflict.id);
        if (!existingConflict.sourceMessageIds.includes(sourceMessageId) && !merges.some((item) => item.memoryId === existingConflict.id)) {
          merges.push({ memoryId: existingConflict.id, sourceMessageId });
        }
        continue;
      }
      creates.push({
        type: "conflict",
        content: `冲突待确认：新说法“${statement}”与已确认记忆“${conflict.content}”不一致。`,
        confidence: 0.96,
        conflictWithId: conflict.id
      });
      blockingConflictIds.push(conflict.id);
      continue;
    }

    const type = inferMemoryType(statement);
    creates.push({ type, content: statement, confidence: type === "constraint" || type === "decision" ? 0.84 : 0.74 });
  }

  return { creates: creates.slice(0, 3), merges, blockingConflictIds: [...new Set(blockingConflictIds)] };
}

export function assertMemoryTransition(memory: Pick<MemoryItem, "status" | "type">, action: MemoryAction) {
  if (memory.status === "superseded") throw new Error("已被替代的记忆不能恢复或修改");
  if (action === "restore" && memory.status !== "forgotten") throw new Error("只有已遗忘记忆可以恢复");
  if (action === "confirm" && memory.status !== "candidate") throw new Error("只有候选记忆可以确认");
  if (action === "correct" && memory.status === "forgotten") throw new Error("请先恢复已遗忘记忆再纠正");
  if (memory.type === "conflict" && (action === "confirm" || action === "restore")) throw new Error("冲突项不能直接确认，请纠正内容或保留原记忆");
}

function lines(title: string, values: string[]) {
  return `[${title}]\n${values.length ? values.map((value) => `- ${value}`).join("\n") : "- （无）"}`;
}

function baselineEntries(baseline: ProductBaseline, version: number): Array<EvidenceRef & { text: string }> {
  const entry = (suffix: string, label: string, text: string) => ({ id: `baseline:v${version}:${suffix}`, kind: "baseline" as const, label, text: `[baseline:v${version}:${suffix}] ${text}` });
  return [
    entry("summary", "正式基线摘要", `摘要：${baseline.summary}`),
    entry("problem", "正式基线问题", `问题：${baseline.problem}`),
    ...baseline.goals.map((item, index) => entry(`goals:${index}`, "正式基线目标", `目标：${item}`)),
    ...baseline.scope.map((item, index) => entry(`scope:${index}`, "正式基线范围", `范围：${item}`)),
    ...baseline.nonGoals.map((item, index) => entry(`nonGoals:${index}`, "正式基线非目标", `非目标：${item}`)),
    ...baseline.requirements.map((item, index) => entry(`requirements:${index}`, "正式基线需求", `正式需求：${item}`)),
    ...baseline.decisions.map((item, index) => entry(`decisions:${index}`, "正式基线决策", `正式决策：${item}`)),
    ...baseline.openQuestions.map((item, index) => entry(`openQuestions:${index}`, "正式基线开放问题", `开放问题：${item}`))
  ];
}

function rankByRelevance<T>(items: T[], query: string, text: (item: T) => string) {
  const target = normalizeMemoryText(query);
  return [...items].sort((left, right) => similarity(normalizeMemoryText(text(right)), target) - similarity(normalizeMemoryText(text(left)), target));
}

function fit(values: string[], budget: number) {
  if (budget <= 0) return [];
  const selected: string[] = [];
  let used = 0;
  for (const value of values) {
    if (selected.length && used + value.length > budget) break;
    selected.push(value.length > budget && !selected.length ? `${value.slice(0, Math.max(0, budget - 1))}…` : value);
    used += value.length;
  }
  return selected;
}

export function assembleProductContext(
  state: Pick<StudioState, "messages" | "memories" | "sources">,
  projectId: string,
  baseline: ProductBaseline,
  query: string,
  budgetChars = 12000,
  baselineVersion = 0
): ProductContext {
  const projectMemories = state.memories.filter((item) => item.projectId === projectId && item.status !== "forgotten" && item.status !== "superseded");
  const confirmed = rankByRelevance(projectMemories.filter((item) => item.status === "confirmed" && item.type !== "conflict"), query, (item) => item.content)
    .sort((left, right) => Number(["constraint", "decision"].includes(right.type)) - Number(["constraint", "decision"].includes(left.type)));
  const candidates = rankByRelevance(projectMemories.filter((item) => item.status === "candidate" && item.type !== "conflict"), query, (item) => item.content);
  const conflicts = projectMemories.filter((item) => item.type === "conflict");
  const recentMessages = state.messages.filter((item) => item.projectId === projectId).slice(-12);
  const recent = recentMessages.map((item) => `[message:${item.id}] ${item.role === "user" ? "用户" : "AI"}：${item.content}`);
  const sources = rankByRelevance(state.sources.filter((item) => item.projectId === projectId && item.status === "ready"), query, (item) => `${item.title} ${item.content || item.excerpt}`);

  const baselineEvidence = baselineEntries(baseline, baselineVersion);
  const baselineSection = lines("正式产品基线", baselineEvidence.map((item) => item.text));
  const confirmedSection = lines("已确认记忆", confirmed.map((item) => `[memory:${item.id}] ${item.type}：${item.content}`));
  const conflictSection = lines("未解决冲突", conflicts.map((item) => `${item.id}：${item.content}`));
  const reserved = baselineSection.length + confirmedSection.length + conflictSection.length + 80;
  const optionalBudget = Math.max(0, budgetChars - reserved);
  const perSourceCap = 6000;
  const sourceLines = sources.map((item) => {
    const body = (item.content && item.content.trim()) || item.excerpt;
    const capped = body.length > perSourceCap ? `${body.slice(0, perSourceCap)}…[材料较长已截断，全文 ${body.length} 字]` : body;
    return `[source:${item.id}] [不可信外部资料] ${item.title}${item.charCount ? `（全文约 ${item.charCount} 字）` : ""}：\n${capped}`;
  });
  const selectedRecent = fit(recent, Math.floor(optionalBudget * 0.35));
  const selectedCandidates = fit(candidates.map((item) => `[memory:${item.id}] ${item.type}（候选、低权重）：${item.content}`), Math.floor(optionalBudget * 0.15));
  const selectedSources = fit(sourceLines, Math.floor(optionalBudget * 0.5));
  const selectedSourceIds = new Set(sources.filter((item) => selectedSources.some((value) => value.includes(`[source:${item.id}]`))).map((item) => item.id));
  const availableEvidence: EvidenceRef[] = [
    ...baselineEvidence.map(({ id, kind, label }) => ({ id, kind, label })),
    ...recentMessages.map((item) => ({ id: `message:${item.id}`, kind: "message" as const, label: `${item.role === "user" ? "用户" : "AI"}消息` })),
    ...projectMemories.map((item) => ({ id: `memory:${item.id}`, kind: "memory" as const, label: `${item.type} 记忆` })),
    ...sources.map((item) => ({ id: `source:${item.id}`, kind: "source" as const, label: item.title }))
  ];
  const text = [
    baselineSection,
    lines("最近对话", selectedRecent),
    confirmedSection,
    lines("候选记忆", selectedCandidates),
    lines("来源片段", selectedSources),
    conflictSection
  ].join("\n\n");
  const evidenceCatalog = availableEvidence.filter((item) => text.includes(`[${item.id}]`));

  return {
    text,
    evidenceCatalog,
    citationIds: sources.filter((item) => selectedSourceIds.has(item.id)).map((item) => item.id),
    counts: {
      recentMessages: selectedRecent.length,
      confirmedMemories: confirmed.length,
      candidateMemories: selectedCandidates.length,
      sources: selectedSources.length,
      conflicts: conflicts.length
    }
  };
}
