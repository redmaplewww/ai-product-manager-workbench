import { agentPacketOutputSchema, agentPacketSchema, type AgentPacket, type AgentPacketOutput } from "@pm-studio/core";
import { CRITICAL_REVIEWER_ID } from "./agents/catalog";

function assertKnownIds(ids: string[], allowed: Set<string>, errorCode: string) {
  if (ids.some((id) => !allowed.has(id))) throw new Error(errorCode);
}

export function normalizeAgentPacket(agentId: string, rawOutput: unknown, evidenceIds: string[], targetRefs: string[] = []): AgentPacket {
  const output: AgentPacketOutput = agentPacketOutputSchema.parse(rawOutput);
  const allowedEvidenceIds = new Set(evidenceIds);
  const allowedTargetRefs = new Set([...evidenceIds, ...targetRefs]);

  for (const assertion of output.assertions) {
    if (assertion.basis === "grounded" && !assertion.evidenceIds.length) throw new Error("GROUNDED_ASSERTION_REQUIRES_EVIDENCE");
    if (assertion.basis === "assumption" && assertion.evidenceIds.length) throw new Error("ASSUMPTION_CANNOT_CITE_EVIDENCE");
  }
  for (const item of [...output.assertions, ...output.clarificationQuestions, ...output.issues]) {
    assertKnownIds(item.evidenceIds, allowedEvidenceIds, "UNKNOWN_EVIDENCE_ID");
  }
  for (const issue of output.issues) assertKnownIds(issue.targetRefs, allowedTargetRefs, "UNKNOWN_TARGET_REF");

  return agentPacketSchema.parse({
    schemaVersion: 1,
    agentId,
    status: "completed",
    summary: output.summary,
    assertions: output.assertions.map((item, index) => ({ ...item, id: `assertion:${agentId}:${index}` })),
    clarificationQuestions: output.clarificationQuestions.map((item, index) => ({ ...item, id: `question:${agentId}:${index}` })),
    issues: output.issues.map((item, index) => ({ ...item, verification: agentId === CRITICAL_REVIEWER_ID ? item.verification || "unresolved" : null, id: `issue:${agentId}:${index}` })),
    error: null
  });
}

export function failedAgentPacket(agentId: string, message: string): AgentPacket {
  return agentPacketSchema.parse({
    schemaVersion: 1,
    agentId,
    status: "failed",
    summary: "该 Agent 未能生成可用结构化结论。",
    assertions: [],
    clarificationQuestions: [],
    issues: [],
    error: message
  });
}

export function packetItemIds(packet: Pick<AgentPacket, "assertions" | "clarificationQuestions" | "issues">) {
  return [
    ...packet.assertions.map((item) => item.id),
    ...packet.clarificationQuestions.map((item) => item.id),
    ...packet.issues.map((item) => item.id)
  ];
}
