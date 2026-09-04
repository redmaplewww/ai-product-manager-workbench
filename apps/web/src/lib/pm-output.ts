import { pmSynthesisOutputSchema, type PmSynthesisOutput } from "@pm-studio/core";

export type NormalizedPmOutput = PmSynthesisOutput;

export function normalizePmOutput(value: unknown): NormalizedPmOutput {
  return pmSynthesisOutputSchema.parse(value);
}

export type PmProposalView = { title: string; rationale: string; items: Array<{ category: string; content: string }> };

export function readPmProposal(output: unknown): PmProposalView | undefined {
  const parsed = pmSynthesisOutputSchema.safeParse(output);
  if (!parsed.success || !parsed.data.proposalItems.length) return undefined;
  return {
    title: parsed.data.proposalTitle || "本轮产品基线候选变更",
    rationale: parsed.data.proposalRationale || "PM 已将本轮内容整理为候选变更",
    items: parsed.data.proposalItems.map(({ category, content }) => ({ category, content }))
  };
}
