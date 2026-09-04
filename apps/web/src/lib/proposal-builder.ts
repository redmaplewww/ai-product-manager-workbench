import { proposalCategories, type AgentPacket, type ProposalCategory } from "@pm-studio/core";
import { comparableText } from "./text-utils";

export type PmProposalChange = {
  itemIds: string[];
  category: ProposalCategory;
  content: string;
  selected?: boolean;
};

export type PmProposal = {
  title: string;
  rationale: string;
  items: PmProposalChange[];
};

export type ProposalSource = {
  id: string;
  content: string;
  kind: "assertion" | "clarification_question";
  basis?: "grounded" | "assumption";
  evidenceIds?: string[];
};

export function proposalSourcesFromPackets(packets: AgentPacket[]): ProposalSource[] {
  return packets.flatMap((packet) => [
    ...packet.assertions.map((item) => ({ id: item.id, content: item.content, kind: "assertion" as const, basis: item.basis, evidenceIds: item.evidenceIds })),
    ...packet.clarificationQuestions.map((item) => ({ id: item.id, content: item.content, kind: "clarification_question" as const, evidenceIds: item.evidenceIds }))
  ]);
}

export const supportedProposalPaths = [
  "/audience/-", "/goals/-", "/metrics/-", "/scope/-", "/nonGoals/-",
  "/requirements/-", "/risks/-", "/decisions/-", "/openQuestions/-"
] as const;
export type ProposalPath = typeof supportedProposalPaths[number];

const categoryToPath: Record<ProposalCategory, ProposalPath> = {
  audience: "/audience/-", goals: "/goals/-", metrics: "/metrics/-", scope: "/scope/-", nonGoals: "/nonGoals/-",
  requirements: "/requirements/-", risks: "/risks/-", decisions: "/decisions/-", openQuestions: "/openQuestions/-"
};

export type NormalizedProposal = {
  title: string;
  rationale: string;
  changes: Array<{ path: ProposalPath; after: string; selected: true; evidenceIds: string[] }>;
};

export function buildProposal(sources: ProposalSource[], pmProposal?: PmProposal): NormalizedProposal | null {
  if (!sources.length || !pmProposal) return null;

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const usedChanges = new Set<string>();
  const modelChanges = pmProposal.items.flatMap((change) => {
    const sourcesForChange = change.itemIds.map((itemId) => sourceById.get(itemId));
    const content = change.content.trim();
    const key = `${change.category}:${comparableText(content)}`;
    const includesQuestion = sourcesForChange.some((source) => source?.kind === "clarification_question");
    if (!sourcesForChange.length || sourcesForChange.some((source) => !source) || !proposalCategories.includes(change.category) || !content || change.selected === false || sourcesForChange.some((source) => source?.basis === "assumption") || (includesQuestion && change.category !== "openQuestions") || sourcesForChange.some((source) => source && comparableText(source.content) === comparableText(content)) || usedChanges.has(key)) return [];
    usedChanges.add(key);
    return [{ path: categoryToPath[change.category], after: content, selected: true as const, evidenceIds: [...new Set(sourcesForChange.flatMap((source) => source?.evidenceIds || []))] }];
  }).slice(0, 8);

  if (!modelChanges.length) return null;

  return {
    title: pmProposal.title.trim() || "本轮产品基线候选变更",
    rationale: pmProposal.rationale.trim() || "PM 已将本轮内容整理为候选变更，审批通过后才会写入正式基线。",
    changes: modelChanges
  };
}
