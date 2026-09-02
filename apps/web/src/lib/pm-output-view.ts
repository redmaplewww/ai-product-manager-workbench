export type PmProposalView = {
  title: string;
  rationale: string;
  items: Array<{ category: string; content: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readPmProposal(output: unknown): PmProposalView | undefined {
  if (!isRecord(output)) return undefined;
  if (Array.isArray(output.proposal)) {
    const items = output.proposal.filter((item): item is { category: string; content: string } => (
      isRecord(item) && typeof item.category === "string" && typeof item.content === "string"
    ));
    return items.length ? {
      title: typeof output.proposalTitle === "string" ? output.proposalTitle : "PM 提案整理",
      rationale: typeof output.proposalRationale === "string" ? output.proposalRationale : "本轮 PM 结构化整理结果",
      items
    } : undefined;
  }
  if (!isRecord(output.proposal)) return undefined;
  const proposal = output.proposal;
  if (typeof proposal.title !== "string" || typeof proposal.rationale !== "string" || !Array.isArray(proposal.changes)) return undefined;
  const items = proposal.changes.filter((change): change is { path: string; after: string } => (
    isRecord(change) && typeof change.path === "string" && typeof change.after === "string"
  )).map((change) => ({ category: change.path.split("/")[1] || "unknown", content: change.after }));
  return items.length ? { title: proposal.title, rationale: proposal.rationale, items } : undefined;
}
