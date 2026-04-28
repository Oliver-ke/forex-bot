import type { TradeJournal } from "@forex-bot/contracts";
import type { EmbeddingProvider, JournalStore, RagStore } from "@forex-bot/data-core";

export interface WriteJournalWithRagDeps {
  journal: JournalStore;
  rag: RagStore;
  embed: EmbeddingProvider;
  regime?: string;
}

export async function writeJournalWithRag(
  j: TradeJournal,
  deps: WriteJournalWithRagDeps,
): Promise<void> {
  await deps.journal.put(j);
  const text = j.verdict.reasoning;
  const [embedding] = await deps.embed.embed([text]);
  if (!embedding) throw new Error("embed returned no vectors");
  const metadata: Record<string, string | number | boolean> = {
    tradeId: j.tradeId,
    symbol: j.symbol,
    direction: j.verdict.direction,
  };
  if (deps.regime) metadata.regime = deps.regime;
  await deps.rag.put({
    id: j.tradeId,
    text,
    embedding,
    modelVersion: deps.embed.modelVersion,
    metadata,
    ts: j.openedAt,
  });
}
