import type { NewsAdapter } from "@forex-bot/data-core";
import { InMemoryHotCache } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { newsWorker } from "../src/workers/news.js";

const fake: NewsAdapter = {
  source: "fake",
  async fetch({ since }) {
    return [
      { ts: since + 1, source: "fake", title: "headline 1" },
      { ts: since + 2, source: "fake", title: "headline 2" },
    ];
  },
};

describe("newsWorker", () => {
  it("pushes headlines into the cache and tracks last-fetch ts", async () => {
    const cache = new InMemoryHotCache();
    const state = { lastFetchTs: 1000 };
    await newsWorker({ adapter: fake, cache, state, nowMs: 5000 });
    const recent = await cache.recentHeadlines({ sinceMs: 0 });
    expect(recent.map((h) => h.title)).toEqual(["headline 1", "headline 2"]);
    expect(state.lastFetchTs).toBe(5000);
  });
});
