export type PmProposalView = {
  title: string;
  rationale: string;
  changes: Array<{ path: string; after: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readPmProposal(output: unknown): PmProposalView | undefined {
  if (!isRecord(output) || !isRecord(output.proposal)) return undefined;
  const proposal = output.proposal;
  if (typeof proposal.title !== "string" || typeof proposal.rationale !== "string" || !Array.isArray(proposal.changes)) return undefined;
  const changes = proposal.changes.filter((change): change is { path: string; after: string } => (
    isRecord(change) && typeof change.path === "string" && typeof change.after === "string"
  ));
  return changes.length ? { title: proposal.title, rationale: proposal.rationale, changes } : undefined;
}
