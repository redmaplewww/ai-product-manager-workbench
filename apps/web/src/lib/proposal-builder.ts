import type { ProposalChangeDraft } from "@pm-studio/core";

export type PmProposalChange = {
  sourceIndex: number;
  path: ProposalPath;
  after: string;
  selected?: boolean;
};

export type PmProposal = {
  title: string;
  rationale: string;
  changes: PmProposalChange[];
};

export const supportedProposalPaths = [
  "/audience/-", "/goals/-", "/metrics/-", "/scope/-", "/nonGoals/-",
  "/requirements/-", "/risks/-", "/decisions/-", "/openQuestions/-"
] as const;
export type ProposalPath = typeof supportedProposalPaths[number];

function comparableText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export type NormalizedProposal = {
  title: string;
  rationale: string;
  changes: ProposalChangeDraft[];
};

export function buildProposal(candidates: ProposalChangeDraft[], pmProposal?: PmProposal): NormalizedProposal | null {
  if (!candidates.length || !pmProposal) return null;

  const usedSources = new Set<number>();
  const modelChanges = pmProposal.changes.flatMap((change) => {
    const candidate = candidates[change.sourceIndex];
    if (!candidate || usedSources.has(change.sourceIndex) || !supportedProposalPaths.includes(change.path) || !change.after.trim() || change.selected === false || comparableText(candidate.after) === comparableText(change.after)) return [];
    usedSources.add(change.sourceIndex);
    return [{ path: change.path, after: change.after.trim(), selected: true as const }];
  }).slice(0, 8);

  if (!modelChanges.length) return null;

  return {
    title: pmProposal.title.trim() || "本轮产品基线候选变更",
    rationale: pmProposal.rationale.trim() || "PM 已将本轮内容整理为候选变更，审批通过后才会写入正式基线。",
    changes: modelChanges
  };
}
