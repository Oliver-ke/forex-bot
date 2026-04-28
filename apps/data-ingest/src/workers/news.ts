import type { HotCache, NewsAdapter } from "@forex-bot/data-core";

export interface NewsWorkerState {
  lastFetchTs: number;
}

export interface NewsWorkerInput {
  adapter: NewsAdapter;
  cache: HotCache;
  state: NewsWorkerState;
  nowMs: number;
}

export async function newsWorker(input: NewsWorkerInput): Promise<void> {
  const items = await input.adapter.fetch({
    since: input.state.lastFetchTs,
    until: input.nowMs,
  });
  for (const h of items) await input.cache.pushHeadline(h);
  input.state.lastFetchTs = input.nowMs;
}
