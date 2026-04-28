import type { TradeJournal } from "@forex-bot/contracts";

export interface EmbeddingProvider {
  readonly modelVersion: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface JournalStore {
  put(j: TradeJournal): Promise<void>;
  get(tradeId: string): Promise<TradeJournal | undefined>;
  list(opts: { limit: number; cursor?: string }): Promise<{
    items: readonly TradeJournal[];
    nextCursor?: string;
  }>;
}

export interface RagDoc {
  id: string;
  text: string;
  embedding: readonly number[];
  modelVersion: string;
  metadata: Record<string, string | number | boolean>;
  ts: number;
}

export interface RagStore {
  put(doc: RagDoc): Promise<void>;
  search(query: {
    embedding: readonly number[];
    k: number;
    filter?: Record<string, string>;
  }): Promise<readonly RagDoc[]>;
}
