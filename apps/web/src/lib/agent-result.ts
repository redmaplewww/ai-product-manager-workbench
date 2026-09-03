import type { AgentPacket } from "@pm-studio/core";

export function formatAgentResults(results: Array<{ agentId: string; agent: string; result: AgentPacket }>) {
  return JSON.stringify(results.map(({ agentId, agent, result }) => ({ agentId, agent, packet: result })));
}
