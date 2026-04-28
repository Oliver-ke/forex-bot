import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisHotCache } from "../src/redis-cache.js";

const URL = process.env.REDIS_TEST_URL ?? "";

describe.skipIf(!URL)("RedisHotCache (integration)", () => {
  let cache: RedisHotCache;

  beforeAll(async () => {
    cache = new RedisHotCache({ url: URL, namespace: `test:${Date.now()}` });
    await cache.connect();
  });

  afterAll(async () => {
    await cache.close();
  });

  it("ticks round-trip per symbol", async () => {
    await cache.setLatestTick({ ts: 1, symbol: "EURUSD", bid: 1.08, ask: 1.0801 });
    expect((await cache.getLatestTick("EURUSD"))?.bid).toBe(1.08);
  });

  it("recentHeadlines respects sinceMs", async () => {
    await cache.pushHeadline({ ts: 100, source: "x", title: "old" });
    await cache.pushHeadline({ ts: 200, source: "x", title: "new" });
    const recent = await cache.recentHeadlines({ sinceMs: 150 });
    expect(recent.map((h) => h.title)).toEqual(["new"]);
  });
});
