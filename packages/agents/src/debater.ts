import type { AnalystOutput, StateBundle } from "@forex-bot/contracts";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { z } from "zod";
import { BEAR_SYSTEM_PROMPT } from "./prompts/bear.js";
import { BULL_SYSTEM_PROMPT } from "./prompts/bull.js";

export const DebaterOutputSchema = z.object({
  side: z.enum(["bull", "bear"]),
  arguments: z.array(z.string().min(1)),
  risks: z.array(z.string().min(1)),
  counters: z.array(z.string().min(1)),
});
export type DebaterOutput = z.infer<typeof DebaterOutputSchema>;

export interface DebateInput {
  side: "bull" | "bear";
  bundle: StateBundle;
  analysts: readonly AnalystOutput[];
  llm: LlmProvider;
}

export async function debate(input: DebateInput): Promise<DebaterOutput> {
  const userMessage = JSON.stringify(
    {
      symbol: input.bundle.symbol,
      regimePrior: input.bundle.regimePrior,
      analysts: input.analysts,
      recentHeadlines: input.bundle.recentNews.slice(-10),
      upcomingHighImpact: input.bundle.upcomingEvents.filter((e) => e.impact === "high"),
    },
    null,
    2,
  );
  return input.llm.structured({
    model: "claude-sonnet-4-6",
    system: input.side === "bull" ? BULL_SYSTEM_PROMPT : BEAR_SYSTEM_PROMPT,
    user: userMessage,
    schema: DebaterOutputSchema,
  });
}
