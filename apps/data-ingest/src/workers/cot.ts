import type { CotAdapter, EmbeddingProvider, RagStore } from "@forex-bot/data-core";

export interface CotWorkerState {
  lastFetchTs: number;
}

export interface CotWorkerInput {
  adapter: CotAdapter;
  rag: RagStore;
  embed: EmbeddingProvider;
  state: CotWorkerState;
  nowMs: number;
}

export async function cotWorker(input: CotWorkerInput): Promise<void> {
  const reports = await input.adapter.fetch({
    since: input.state.lastFetchTs,
    until: input.nowMs,
  });
  const texts = reports.map(
    (r) => `${r.symbol} COT: net non-commercial ${r.netNonCommercial}, change ${r.changeWeekly}`,
  );
  if (texts.length === 0) {
    input.state.lastFetchTs = input.nowMs;
    return;
  }
  const embeddings = await input.embed.embed(texts);
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i] as (typeof reports)[number];
    const e = embeddings[i] as readonly number[];
    const text = texts[i] as string;
    await input.rag.put({
      id: `cot:${r.symbol}:${r.ts}`,
      text,
      embedding: e,
      modelVersion: input.embed.modelVersion,
      metadata: {
        source: input.adapter.source,
        symbol: r.symbol,
        netNonCommercial: r.netNonCommercial,
        netCommercial: r.netCommercial,
        changeWeekly: r.changeWeekly,
      },
      ts: r.ts,
    });
  }
  input.state.lastFetchTs = input.nowMs;
}
