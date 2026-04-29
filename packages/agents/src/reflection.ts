import type { TradeJournal, TradeOutcome } from "@forex-bot/contracts";
import type { RagDoc } from "@forex-bot/data-core";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { z } from "zod";
import { REFLECTION_SYSTEM_PROMPT } from "./prompts/reflection.js";

export const ReflectionOutputSchema = z.object({
  lesson: z.string().min(1),
  tags: z.array(z.string().min(1)).min(2).max(5),
  confidence: z.number().min(0).max(1),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

export interface ReflectInput {
  journal: TradeJournal;
  outcome: TradeOutcome;
  ragHits?: readonly RagDoc[];
  llm: LlmProvider;
}

export async function reflect(input: ReflectInput): Promise<ReflectionOutput> {
  const userMessage = JSON.stringify(
    {
      journal: input.journal,
      outcome: input.outcome,
      similarPastTrades: (input.ragHits ?? []).slice(0, 5).map((d) => ({
        id: d.id,
        text: d.text.slice(0, 400),
        metadata: d.metadata,
      })),
    },
    null,
    2,
  );
  return input.llm.structured({
    model: "claude-opus-4-7",
    system: REFLECTION_SYSTEM_PROMPT,
    user: userMessage,
    schema: ReflectionOutputSchema,
    effort: "xhigh",
  });
}
