import { describe, expect, it } from "vitest";
import {
  FakeEmbeddingProvider,
  InMemoryHotCache,
  InMemoryJournalStore,
  InMemoryRagStore,
} from "../src/fakes.js";

describe("FakeEmbeddingProvider", () => {
  it("returns vectors of declared dimension and is deterministic", async () => {
    const e = new FakeEmbeddingProvider({ dimension: 8, modelVersion: "fake-v1" });
    const [a, b] = await e.embed(["hello", "hello"]);
    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
  });

  it("identical inputs → identical vectors; different inputs → different vectors", async () => {
    const e = new FakeEmbeddingProvider({ dimension: 4, modelVersion: "fake-v1" });
    const [a, b] = await e.embed(["foo", "bar"]);
    expect(a).not.toEqual(b);
  });
});

describe("InMemoryJournalStore", () => {
  it("round-trips a TradeJournal", async () => {
    const s = new InMemoryJournalStore();
    const j = {
      tradeId: "t-1",
      symbol: "EURUSD" as const,
      openedAt: 1,
      verdict: {
        direction: "long" as const,
        confidence: 0.8,
        horizon: "H1" as const,
        reasoning: "x",
      },
      risk: {
        approve: true as const,
        lotSize: 0.1,
        sl: 1.07,
        tp: 1.09,
        expiresAt: 2,
        reasons: ["ok"],
      },
    };
    await s.put(j);
    expect((await s.get("t-1"))?.tradeId).toBe("t-1");
    expect(await s.get("missing")).toBeUndefined();
  });

  it("list returns newest-first and paginates with cursor", async () => {
    const s = new InMemoryJournalStore();
    for (let i = 0; i < 5; i++) {
      await s.put({
        tradeId: `t-${i}`,
        symbol: "EURUSD",
        openedAt: i * 1000,
        verdict: { direction: "long", confidence: 0.5, horizon: "H1", reasoning: "x" },
        risk: { approve: true, lotSize: 0.1, sl: 1.07, tp: 1.09, expiresAt: 0, reasons: ["ok"] },
      });
    }
    const page1 = await s.list({ limit: 2 });
    expect(page1.items.map((j) => j.tradeId)).toEqual(["t-4", "t-3"]);
    const page2 = await s.list({
      limit: 2,
      ...(page1.nextCursor !== undefined ? { cursor: page1.nextCursor } : {}),
    });
    expect(page2.items.map((j) => j.tradeId)).toEqual(["t-2", "t-1"]);
  });
});

describe("InMemoryRagStore", () => {
  it("returns top-K by cosine similarity", async () => {
    const s = new InMemoryRagStore();
    await s.put({
      id: "a",
      text: "a",
      embedding: [1, 0, 0],
      modelVersion: "v1",
      metadata: {},
      ts: 1,
    });
    await s.put({
      id: "b",
      text: "b",
      embedding: [0, 1, 0],
      modelVersion: "v1",
      metadata: {},
      ts: 2,
    });
    await s.put({
      id: "c",
      text: "c",
      embedding: [0.9, 0.1, 0],
      modelVersion: "v1",
      metadata: {},
      ts: 3,
    });
    const out = await s.search({ embedding: [1, 0, 0], k: 2 });
    expect(out.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("supports metadata exact-match filters", async () => {
    const s = new InMemoryRagStore();
    await s.put({
      id: "a",
      text: "a",
      embedding: [1, 0],
      modelVersion: "v1",
      metadata: { regime: "trending" },
      ts: 1,
    });
    await s.put({
      id: "b",
      text: "b",
      embedding: [1, 0],
      modelVersion: "v1",
      metadata: { regime: "ranging" },
      ts: 2,
    });
    const out = await s.search({ embedding: [1, 0], k: 5, filter: { regime: "trending" } });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("InMemoryHotCache", () => {
  it("stores latest tick per symbol", async () => {
    const c = new InMemoryHotCache();
    await c.setLatestTick({ ts: 1, symbol: "EURUSD", bid: 1.08, ask: 1.0801 });
    await c.setLatestTick({ ts: 2, symbol: "EURUSD", bid: 1.0805, ask: 1.0806 });
    expect((await c.getLatestTick("EURUSD"))?.bid).toBe(1.0805);
  });

  it("recentHeadlines drops items older than sinceMs", async () => {
    const c = new InMemoryHotCache();
    await c.pushHeadline({ ts: 1, source: "x", title: "old" });
    await c.pushHeadline({ ts: 100, source: "x", title: "new" });
    expect((await c.recentHeadlines({ sinceMs: 50 })).map((h) => h.title)).toEqual(["new"]);
  });

  it("setCalendarWindow replaces wholesale", async () => {
    const c = new InMemoryHotCache();
    await c.setCalendarWindow([{ ts: 1, currency: "USD", impact: "high", title: "CPI" }]);
    await c.setCalendarWindow([{ ts: 2, currency: "EUR", impact: "low", title: "PMI" }]);
    const w = await c.getCalendarWindow();
    expect(w.map((e) => e.currency)).toEqual(["EUR"]);
  });
});
