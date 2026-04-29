import { type AnalystOutput, AnalystOutputSchema, type StateBundle } from "@forex-bot/contracts";
import { ema, rsi } from "@forex-bot/indicators";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { TA_SYSTEM_PROMPT } from "./prompts/ta.js";

export interface TaAnalystInput {
  bundle: StateBundle;
  llm: LlmProvider;
}

export async function taAnalyst({ bundle, llm }: TaAnalystInput): Promise<AnalystOutput> {
  const closesH1 = bundle.market.H1.map((c) => c.close);
  const ema20 =
    closesH1.length >= 1 ? ema(closesH1, Math.max(1, Math.min(20, closesH1.length))) : [];
  const rsi14 =
    closesH1.length >= 2 ? rsi(closesH1, Math.max(1, Math.min(14, closesH1.length - 1))) : [];
  const last = bundle.market.H1.at(-1);
  const userMessage = JSON.stringify(
    {
      symbol: bundle.symbol,
      regimePrior: bundle.regimePrior,
      lastH1: last,
      ema20Last: ema20.at(-1) ?? null,
      rsi14Last: rsi14.at(-1) ?? null,
      m15Last: bundle.market.M15.at(-1),
      h4Last: bundle.market.H4.at(-1),
      d1Last: bundle.market.D1.at(-1),
    },
    null,
    2,
  );
  return llm.structured({
    model: "claude-sonnet-4-6",
    system: TA_SYSTEM_PROMPT,
    user: userMessage,
    schema: AnalystOutputSchema,
  });
}
