export function proposalChangeKey(proposalId: string, path: string, index: number) {
  return `${proposalId}:${path}:${index}`;
}
