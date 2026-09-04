import { pmSynthesisOutputSchema, type PmSynthesisOutput } from "@pm-studio/core";

export const PM_DEFAULT_TITLE = "本轮产品基线候选变更";
export const PM_DEFAULT_RATIONALE = "PM 已将本轮内容整理为候选变更，审批通过后才会写入正式基线。";

export type NormalizedPmOutput = PmSynthesisOutput;

export function normalizePmOutput(value: unknown): NormalizedPmOutput {
  return pmSynthesisOutputSchema.parse(value);
}

export type PmProposalView = { title: string; rationale: string; items: Array<{ category: string; content: string }> };

export function readPmProposal(output: unknown): PmProposalView | undefined {
  const parsed = pmSynthesisOutputSchema.safeParse(output);
  if (!parsed.success || !parsed.data.proposalItems.length) return undefined;
  return {
    title: parsed.data.proposalTitle || PM_DEFAULT_TITLE,
    rationale: parsed.data.proposalRationale || PM_DEFAULT_RATIONALE,
    items: parsed.data.proposalItems.map(({ category, content }) => ({ category, content }))
  };
}
