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

export const proposalCategories = ["audience", "goals", "metrics", "scope", "nonGoals", "requirements", "risks", "decisions", "openQuestions"] as const;
export const proposalCategorySchema = z.enum(proposalCategories);

// 全部分支统一为数组 append 语义：path 恒为 `/${category}/-`，由分类直接派生，不维护第二份手写表。
// 若将来出现非 append 路径（如 replace 语义），此派生失效，需停下来重审。
export type ProposalPath = `/${z.infer<typeof proposalCategorySchema>}/-`;
export const supportedProposalPaths: readonly ProposalPath[] = proposalCategories.map(
  (category): ProposalPath => `/${category}/-`
);
export function pathForCategory(category: z.infer<typeof proposalCategorySchema>): ProposalPath {
  return `/${category}/-`;
}
export function pathToCategory(path: string): z.infer<typeof proposalCategorySchema> | undefined {
  if (!path.startsWith("/") || !path.endsWith("/-")) return undefined;
  const category = path.slice(1, -2);
  return (proposalCategories as readonly string[]).includes(category)
    ? category as z.infer<typeof proposalCategorySchema>
    : undefined;
}
export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(["message", "source", "memory", "baseline"]),
  label: z.string()
});
export const assertionBasisSchema = z.enum(["grounded", "assumption"]);
export const assertionOutputSchema = z.object({
  basis: assertionBasisSchema,
  content: z.string(),
  evidenceIds: z.array(z.string())
});
export const clarificationQuestionOutputSchema = z.object({
  content: z.string(),
  evidenceIds: z.array(z.string())
});
export const reviewIssueKindSchema = z.enum(["contradiction", "unsupported", "scope_expansion", "duplicate", "missing_boundary"]);
export const reviewIssueOutputSchema = z.object({
  kind: reviewIssueKindSchema,
  severity: z.enum(["blocking", "warning"]),
  targetRefs: z.array(z.string()),
  detail: z.string(),
  evidenceIds: z.array(z.string()),
  verification: z.enum(["confirmed", "rejected", "unresolved"]).nullable().default(null)
});
export const agentPacketOutputSchema = z.object({
  summary: z.string(),
  assertions: z.array(assertionOutputSchema),
  clarificationQuestions: z.array(clarificationQuestionOutputSchema),
  issues: z.array(reviewIssueOutputSchema)
});
export const agentPacketSchema = z.object({
  schemaVersion: z.literal(1),
  agentId: z.string(),
  status: z.enum(["completed", "failed"]),
  summary: z.string(),
  assertions: z.array(assertionOutputSchema.extend({ id: z.string() })),
  clarificationQuestions: z.array(clarificationQuestionOutputSchema.extend({ id: z.string() })),
  issues: z.array(reviewIssueOutputSchema.extend({ id: z.string() })),
  error: z.string().nullable()
}).superRefine((packet, ctx) => {
  if (packet.status === "completed" && packet.error !== null) ctx.addIssue({ code: "custom", path: ["error"], message: "completed packet cannot contain an error" });
  if (packet.status === "failed" && packet.error === null) ctx.addIssue({ code: "custom", path: ["error"], message: "failed packet requires an error" });
});
export const reviewResponseSchema = z.object({
  issueId: z.string(),
  disposition: z.enum(["surfaced", "resolved", "needs_clarification"]),
  message: z.string()
});
export const pmProposalItemSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(4),
  category: proposalCategorySchema,
  content: z.string().trim().min(1).max(1000),
  selected: z.boolean().default(true)
});
export const pmSynthesisOutputSchema = z.object({
  answer: z.string(),
  reviewResponses: z.array(reviewResponseSchema),
  proposalTitle: z.string().nullable(),
  proposalRationale: z.string().nullable(),
  proposalItems: z.array(pmProposalItemSchema)
});
export const proposalSourceSchema = z.object({
  id: z.string(),
  content: z.string(),
  kind: z.enum(["assertion", "clarification_question"]),
  basis: assertionBasisSchema.optional(),
  evidenceIds: z.array(z.string()).optional()
});
export const proposalChangeSchema = z.object({
  path: z.string().refine((value): value is ProposalPath => pathToCategory(value) !== undefined, "UNKNOWN_PROPOSAL_PATH"),
  before: z.unknown().optional(),
  after: z.string(),
  selected: z.boolean().default(true),
  evidenceIds: z.array(z.string()).default([])
});
export const agentStepOutputSchema = pmSynthesisOutputSchema.partial().extend({
  fallbackReason: z.string().optional(),
  proposalCandidates: z.array(proposalSourceSchema).optional()
}).strict();

export const agentStepSchema = z.object({
  id: z.string(), agent: z.string(), provider: z.string(), model: z.string(), status: z.enum(["queued", "running", "completed", "failed"]),
  summary: z.string(), result: agentPacketSchema.optional(), output: agentStepOutputSchema.optional(), durationMs: z.number(), retries: z.number(), startedAt: z.string()
});

export const runSchema = z.object({
  id: z.string(), projectId: z.string(), status: z.enum(["queued", "running", "completed", "failed"]), steps: z.array(agentStepSchema),
  costUsd: z.number(), durationMs: z.number(), demoMode: z.boolean(), createdAt: z.string(), completedAt: z.string().optional()
});

export const proposalSchema = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), rationale: z.string(), baseVersion: z.number(), status: z.enum(["pending", "accepted", "rejected", "stale"]),
  changes: z.array(proposalChangeSchema),
  createdByRunId: z.string().optional(), createdAt: z.string(), reviewedAt: z.string().optional()
});

export const memorySchema = z.object({
  id: z.string(), projectId: z.string(), type: memoryTypeSchema, content: z.string(), confidence: z.number().min(0).max(1), status: memoryStatusSchema,
  sourceMessageIds: z.array(z.string()), supersedesId: z.string().optional(), conflictWithId: z.string().optional(), validUntil: z.string().optional(), createdAt: z.string(), updatedAt: z.string()
});

export const sourceSchema = z.object({
  id: z.string(), projectId: z.string(), kind: z.enum(["file", "web", "document", "conversation"]), title: z.string(), url: z.string().optional(), mimeType: z.string().optional(),
  status: z.enum(["processing", "ready", "failed"]), excerpt: z.string(), size: z.number(), charCount: z.number().optional(),
  content: z.string().optional(), createdAt: z.string()
});

export const sourceTextImportSchema = z.object({
  mode: z.enum(["document", "conversation"]),
  title: z.string().trim().min(1, "请填写标题").max(160),
  content: z.string().trim().min(1, "内容不能为空").max(400000, "单次导入不超过 40 万字，请拆分后导入")
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
export type AgentPacket = z.infer<typeof agentPacketSchema>;
export type AgentPacketOutput = z.infer<typeof agentPacketOutputSchema>;
export type PmSynthesisOutput = z.infer<typeof pmSynthesisOutputSchema>;
export type PmProposalItem = z.infer<typeof pmProposalItemSchema>;
export type ProposalSource = z.infer<typeof proposalSourceSchema>;
export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type ProposalCategory = z.infer<typeof proposalCategorySchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type AgentRun = z.infer<typeof runSchema>;
export type ChangeProposal = z.infer<typeof proposalSchema>;
export type MemoryItem = z.infer<typeof memorySchema>;
export type Source = z.infer<typeof sourceSchema>;
