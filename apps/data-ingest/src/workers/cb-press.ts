import type { CbAdapter, EmbeddingProvider, RagStore } from "@forex-bot/data-core";

export interface CbPressWorkerState {
  lastFetchTs: number;
}

export interface CbPressWorkerInput {
  adapter: CbAdapter;
  rag: RagStore;
  embed: EmbeddingProvider;
  state: CbPressWorkerState;
  nowMs: number;
}

export async function cbPressWorker(input: CbPressWorkerInput): Promise<void> {
  const docs = await input.adapter.fetch({
    since: input.state.lastFetchTs,
    until: input.nowMs,
  });
  if (docs.length === 0) {
    input.state.lastFetchTs = input.nowMs;
    return;
  }
  const embeddings = await input.embed.embed(docs.map((d) => d.body));
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i] as (typeof docs)[number];
    const e = embeddings[i] as readonly number[];
    await input.rag.put({
      id: `${d.bank}:${d.kind}:${d.ts}`,
      text: d.body,
      embedding: e,
      modelVersion: input.embed.modelVersion,
      metadata: {
        bank: d.bank,
        kind: d.kind,
        source: input.adapter.source,
        url: d.url,
        title: d.title,
      },
      ts: d.ts,
    });
  }
  input.state.lastFetchTs = input.nowMs;
}
