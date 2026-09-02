export type PmProposalChange = {
  sourceIndex: number;
  category: ProposalCategory;
  content: string;
  selected?: boolean;
};

export type PmProposal = {
  title: string;
  rationale: string;
  items: PmProposalChange[];
};

export type ProposalSource = { content: string };

export const supportedProposalPaths = [
  "/audience/-", "/goals/-", "/metrics/-", "/scope/-", "/nonGoals/-",
  "/requirements/-", "/risks/-", "/decisions/-", "/openQuestions/-"
] as const;
export type ProposalPath = typeof supportedProposalPaths[number];
export const supportedProposalCategories = [
  "audience", "goals", "metrics", "scope", "nonGoals", "requirements", "risks", "decisions", "openQuestions"
] as const;
export type ProposalCategory = typeof supportedProposalCategories[number];

const categoryToPath: Record<ProposalCategory, ProposalPath> = {
  audience: "/audience/-", goals: "/goals/-", metrics: "/metrics/-", scope: "/scope/-", nonGoals: "/nonGoals/-",
  requirements: "/requirements/-", risks: "/risks/-", decisions: "/decisions/-", openQuestions: "/openQuestions/-"
};

function comparableText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export type NormalizedProposal = {
  title: string;
  rationale: string;
  changes: Array<{ path: ProposalPath; after: string; selected: true }>;
};

export function buildProposal(sources: ProposalSource[], pmProposal?: PmProposal): NormalizedProposal | null {
  if (!sources.length || !pmProposal) return null;

  const usedChanges = new Set<string>();
  const modelChanges = pmProposal.items.flatMap((change) => {
    const source = sources[change.sourceIndex];
    const content = change.content.trim();
    const key = `${change.category}:${comparableText(content)}`;
    if (!source || !supportedProposalCategories.includes(change.category) || !content || change.selected === false || comparableText(source.content) === comparableText(content) || usedChanges.has(key)) return [];
    usedChanges.add(key);
    return [{ path: categoryToPath[change.category], after: content, selected: true as const }];
  }).slice(0, 8);

  if (!modelChanges.length) return null;

  return {
    title: pmProposal.title.trim() || "本轮产品基线候选变更",
    rationale: pmProposal.rationale.trim() || "PM 已将本轮内容整理为候选变更，审批通过后才会写入正式基线。",
    changes: modelChanges
  };
}
