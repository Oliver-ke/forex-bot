import { type AnalystOutput, AnalystOutputSchema, type StateBundle } from "@forex-bot/contracts";
import type { RagDoc } from "@forex-bot/data-core";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { SENTIMENT_SYSTEM_PROMPT } from "./prompts/sentiment.js";

export interface SentimentAnalystInput {
  bundle: StateBundle;
  llm: LlmProvider;
  /** Pre-retrieved RAG hits for the symbol, e.g. CB press releases / speeches. */
  ragHits?: readonly RagDoc[];
}

export async function sentimentAnalyst(input: SentimentAnalystInput): Promise<AnalystOutput> {
  const headlines = input.bundle.recentNews.slice(-20);
  const ragSummaries = (input.ragHits ?? []).slice(0, 5).map((d) => ({
    title: d.metadata.title ?? d.id,
    bank: d.metadata.bank,
    text: d.text.slice(0, 400),
  }));
  const userMessage = JSON.stringify(
    {
      symbol: input.bundle.symbol,
      ts: input.bundle.ts,
      regimePrior: input.bundle.regimePrior,
      recentHeadlines: headlines,
      ragHits: ragSummaries,
    },
    null,
    2,
  );
  return input.llm.structured({
    model: "claude-sonnet-4-6",
    system: SENTIMENT_SYSTEM_PROMPT,
    user: userMessage,
    schema: AnalystOutputSchema,
  });
}
