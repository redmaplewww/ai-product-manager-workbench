import type { AgentResult } from "@pm-studio/core";

export function formatAgentResults(results: Array<{ agent: string; result: AgentResult }>) {
  return JSON.stringify(results.map(({ agent, result }) => ({ agent, result })));
}
