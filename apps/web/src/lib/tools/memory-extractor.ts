import { planMemoryUpdates, type MemoryItem, type MemoryUpdatePlan } from "@pm-studio/core";

export type MemoryExtractorInput = {
  content: string;
  memories: MemoryItem[];
  sourceMessageId: string;
};

export function extractMemory(input: MemoryExtractorInput): MemoryUpdatePlan {
  return planMemoryUpdates(input.content, input.memories, input.sourceMessageId);
}
