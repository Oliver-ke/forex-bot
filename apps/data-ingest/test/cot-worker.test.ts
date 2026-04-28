import type { CotAdapter, RagStore } from "@forex-bot/data-core";
import { FakeEmbeddingProvider, InMemoryRagStore } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { cotWorker } from "../src/workers/cot.js";

const fake: CotAdapter = {
  source: "cftc-fake",
  async fetch() {
    return [
      {
        ts: 100,
        symbol: "EURUSD",
        netNonCommercial: 50_000,
        netCommercial: -60_000,
        changeWeekly: 1_000,
      },
      {
        ts: 100,
        symbol: "GBPUSD",
        netNonCommercial: 30_000,
        netCommercial: -40_000,
        changeWeekly: -500,
      },
    ];
  },
};

describe("cotWorker", () => {
  it("writes one RagDoc per report row with COT metadata", async () => {
    const rag: RagStore = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 4, modelVersion: "fake-v1" });
    const state = { lastFetchTs: 0 };
    await cotWorker({ adapter: fake, rag, embed, state, nowMs: 200 });
    const all = await rag.search({ embedding: [1, 0, 0, 0], k: 5 });
    expect(all).toHaveLength(2);
    expect(all.every((d) => d.metadata.source === "cftc-fake")).toBe(true);
    expect(state.lastFetchTs).toBe(200);
  });
});
