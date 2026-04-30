import { type AnalystOutput, AnalystOutputSchema, type StateBundle } from "@forex-bot/contracts";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { FUNDAMENTAL_SYSTEM_PROMPT } from "./prompts/fundamental.js";

export interface FundamentalAnalystInput {
  bundle: StateBundle;
  llm: LlmProvider;
  /** Optional rate-differential snapshot (e.g. {EUR: 4.0, USD: 5.5}). */
  rateBps?: Record<string, number>;
  /** Optional COT positioning hint (net non-commercial, change). */
  cotHint?: { netNonCommercial: number; changeWeekly: number };
}

export async function fundamentalAnalyst(input: FundamentalAnalystInput): Promise<AnalystOutput> {
  const highImpact = input.bundle.upcomingEvents.filter((e) => e.impact === "high");
  const userMessage = JSON.stringify(
    {
      symbol: input.bundle.symbol,
      ts: input.bundle.ts,
      regimePrior: input.bundle.regimePrior,
      highImpactEvents: highImpact,
      rateDifferentialBps: input.rateBps ?? null,
      cotHint: input.cotHint ?? null,
    },
    null,
    2,
  );
  return input.llm.structured({
    model: "claude-sonnet-4-6",
    system: FUNDAMENTAL_SYSTEM_PROMPT,
    user: userMessage,
    schema: AnalystOutputSchema,
  });
}
