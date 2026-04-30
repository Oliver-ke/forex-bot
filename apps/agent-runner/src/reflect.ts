import { type ReflectionOutput, reflect as reflectAgent } from "@forex-bot/agents";
import type { TradeJournal, TradeOutcome } from "@forex-bot/contracts";
import type { EmbeddingProvider, JournalStore, RagDoc, RagStore } from "@forex-bot/data-core";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { writeJournalWithRag } from "@forex-bot/memory";

export interface ReflectOnCloseInput {
  journal: TradeJournal;
  outcome: TradeOutcome;
  llm: LlmProvider;
  journalStore: JournalStore;
  rag: RagStore;
  embed: EmbeddingProvider;
  /** RAG search depth for similar past trades. Defaults to 5. */
  similarK?: number;
  /** Optional regime tag to attach to the new RAG entry. */
  regime?: string;
}

export interface ReflectOnCloseResult {
  lesson: ReflectionOutput;
  updatedJournal: TradeJournal;
}

export async function reflectOnClose(input: ReflectOnCloseInput): Promise<ReflectOnCloseResult> {
  const k = input.similarK ?? 5;
  const filter: Record<string, string> = {
    symbol: input.journal.symbol,
    direction: input.journal.verdict.direction,
  };
  let ragHits: readonly RagDoc[] = [];
  const seedText = input.journal.verdict.reasoning;
  const [seedEmbedding] = await input.embed.embed([seedText]);
  if (seedEmbedding) {
    ragHits = await input.rag.search({ embedding: seedEmbedding, k, filter });
  }

  const lesson = await reflectAgent({
    journal: input.journal,
    outcome: input.outcome,
    ragHits,
    llm: input.llm,
  });

  const updatedJournal: TradeJournal = { ...input.journal, outcome: input.outcome };
  await writeJournalWithRag(updatedJournal, {
    journal: input.journalStore,
    rag: input.rag,
    embed: input.embed,
    ...(input.regime ? { regime: input.regime } : {}),
  });

  return { lesson, updatedJournal };
}
