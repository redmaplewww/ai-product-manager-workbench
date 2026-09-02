import type { ProposalChangeDraft } from "@pm-studio/core";

export type PmProposalChange = {
  sourceIndex: number;
  path: string;
  after: string;
  selected?: boolean;
};

export type PmProposal = {
  title: string;
  rationale: string;
  changes: PmProposalChange[];
};

export type NormalizedProposal = {
  title: string;
  rationale: string;
  changes: ProposalChangeDraft[];
};

export function buildProposal(candidates: ProposalChangeDraft[], pmProposal?: PmProposal): NormalizedProposal | null {
  if (!candidates.length) return null;

  const usedSources = new Set<number>();
  const modelChanges = pmProposal?.changes.flatMap((change) => {
    const candidate = candidates[change.sourceIndex];
    if (!candidate || usedSources.has(change.sourceIndex) || candidate.path !== change.path || !change.after.trim() || change.selected === false) return [];
    usedSources.add(change.sourceIndex);
    return [{ path: candidate.path, after: change.after.trim(), selected: true as const }];
  }).slice(0, 8) || [];

  return {
    title: pmProposal?.title.trim() || "本轮产品基线候选变更",
    rationale: pmProposal?.rationale.trim() || `由本轮已明确的 ${candidates.length} 项产品信息整理而来，审批通过后才会写入正式基线。`,
    changes: modelChanges.length ? modelChanges : candidates.slice(0, 8)
  };
}
