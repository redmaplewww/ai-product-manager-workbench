import { z } from "zod";

export const roleSchema = z.enum(["admin", "editor", "reviewer"]);
export const projectStageSchema = z.enum(["discovery", "definition", "planning", "delivery"]);
export const memoryTypeSchema = z.enum(["fact", "constraint", "decision", "preference", "assumption", "risk", "open_question", "conflict"]);
export const memoryStatusSchema = z.enum(["candidate", "confirmed", "forgotten", "superseded"]);

export const userSchema = z.object({
  id: z.string(), name: z.string(), username: z.string(), role: roleSchema,
  passwordHash: z.string().optional(), mustChangePassword: z.boolean().default(false), createdAt: z.string()
});

export const workItemSchema = z.object({
  id: z.string(), title: z.string(), type: z.enum(["research", "design", "feature", "engineering", "operations", "compliance"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]), ownerRole: z.string(), estimate: z.string(), status: z.enum(["planned", "ready", "in_progress", "done"]),
  dependencies: z.array(z.string()), risks: z.array(z.string()), acceptanceCriteria: z.array(z.string())
});

export const epicSchema = z.object({ id: z.string(), title: z.string(), capabilityId: z.string(), workItems: z.array(workItemSchema) });
export const capabilitySchema = z.object({ id: z.string(), title: z.string(), outcomeId: z.string(), epics: z.array(epicSchema) });
export const outcomeSchema = z.object({ id: z.string(), title: z.string(), metric: z.string(), capabilities: z.array(capabilitySchema) });

export const baselineSchema = z.object({
  summary: z.string(), problem: z.string(), audience: z.array(z.string()), goals: z.array(z.string()), metrics: z.array(z.string()),
  scope: z.array(z.string()), nonGoals: z.array(z.string()), requirements: z.array(z.string()), risks: z.array(z.string()),
  decisions: z.array(z.string()), openQuestions: z.array(z.string()), outcomes: z.array(outcomeSchema)
});

export const projectSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), stage: projectStageSchema, language: z.string(), baselineVersion: z.number(),
  pendingProposals: z.number(), openQuestions: z.number(), updatedAt: z.string(), createdAt: z.string()
});

export const messageSchema = z.object({
  id: z.string(), projectId: z.string(), role: z.enum(["user", "assistant", "system"]), author: z.string(), content: z.string(),
  citations: z.array(z.string()).default([]), runId: z.string().optional(), createdAt: z.string()
});

export const agentResultSchema = z.object({
  summary: z.string(),
  findings: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([])
});

export const agentStepSchema = z.object({
  id: z.string(), agent: z.string(), provider: z.string(), model: z.string(), status: z.enum(["queued", "running", "completed", "failed"]),
  summary: z.string(), result: agentResultSchema.optional(), output: z.unknown().optional(), durationMs: z.number(), retries: z.number(), startedAt: z.string()
});

export const runSchema = z.object({
  id: z.string(), projectId: z.string(), status: z.enum(["queued", "running", "completed", "failed"]), steps: z.array(agentStepSchema),
  costUsd: z.number(), durationMs: z.number(), demoMode: z.boolean(), createdAt: z.string(), completedAt: z.string().optional()
});

export const proposalSchema = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), rationale: z.string(), baseVersion: z.number(), status: z.enum(["pending", "accepted", "rejected", "stale"]),
  changes: z.array(z.object({ path: z.string(), before: z.unknown().optional(), after: z.unknown(), selected: z.boolean().default(true) })),
  createdByRunId: z.string().optional(), createdAt: z.string(), reviewedAt: z.string().optional()
});

export const memorySchema = z.object({
  id: z.string(), projectId: z.string(), type: memoryTypeSchema, content: z.string(), confidence: z.number().min(0).max(1), status: memoryStatusSchema,
  sourceMessageIds: z.array(z.string()), supersedesId: z.string().optional(), conflictWithId: z.string().optional(), validUntil: z.string().optional(), createdAt: z.string(), updatedAt: z.string()
});

export const sourceSchema = z.object({
  id: z.string(), projectId: z.string(), kind: z.enum(["file", "web"]), title: z.string(), url: z.string().optional(), mimeType: z.string().optional(),
  status: z.enum(["processing", "ready", "failed"]), excerpt: z.string(), size: z.number(), createdAt: z.string()
});

export const modelProfileSchema = z.object({
  id: z.string(), role: z.string(), provider: z.enum(["openai", "deepseek", "demo"]), model: z.string(), enabled: z.boolean(), configured: z.boolean(),
  capabilities: z.array(z.enum(["structured", "tools", "stream", "vision", "reasoning", "embedding"]))
});

export const evolutionProposalSchema = z.object({
  id: z.string(), title: z.string(), status: z.enum(["draft", "passed", "published", "rejected", "rolled_back"]), promptArea: z.string(),
  baselineScore: z.number(), candidateScore: z.number(), schemaValid: z.boolean(), unauthorizedActions: z.number(), evaluatedCases: z.number(),
  changeSummary: z.string(), createdAt: z.string(), publishedAt: z.string().optional()
});

export const artifactVersionSchema = z.object({
  id: z.string(), projectId: z.string(), version: z.number(), baseline: baselineSchema, createdAt: z.string(), createdBy: z.string()
});

export const auditEventSchema = z.object({ id: z.string(), actorId: z.string(), action: z.string(), target: z.string(), detail: z.string(), createdAt: z.string() });

export const studioStateSchema = z.object({
  users: z.array(userSchema), projects: z.array(projectSchema), messages: z.array(messageSchema), runs: z.array(runSchema), proposals: z.array(proposalSchema),
  memories: z.array(memorySchema), sources: z.array(sourceSchema), artifactVersions: z.array(artifactVersionSchema), models: z.array(modelProfileSchema),
  evolutionProposals: z.array(evolutionProposalSchema), auditEvents: z.array(auditEventSchema)
});

export const sendMessageInputSchema = z.object({ content: z.string().trim().min(1).max(12000) });
export const createProjectInputSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().min(4).max(500) });

export type StudioState = z.infer<typeof studioStateSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProductBaseline = z.infer<typeof baselineSchema>;
export type Message = z.infer<typeof messageSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
export type AgentRun = z.infer<typeof runSchema>;
export type ChangeProposal = z.infer<typeof proposalSchema>;
export type MemoryItem = z.infer<typeof memorySchema>;
export type Source = z.infer<typeof sourceSchema>;
