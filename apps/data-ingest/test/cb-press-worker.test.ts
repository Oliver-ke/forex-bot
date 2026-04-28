import type { CbAdapter } from "@forex-bot/data-core";
import { FakeEmbeddingProvider, InMemoryRagStore } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { cbPressWorker } from "../src/workers/cb-press.js";

const fake: CbAdapter = {
  source: "fake",
  async fetch({ since }) {
    return [
      {
        ts: since + 1,
        bank: "FED",
        kind: "press_release",
        title: "FOMC statement",
        url: "https://example/1",
        body: "Rates unchanged. Inflation pressures easing.",
      },
    ];
  },
};

describe("cbPressWorker", () => {
  it("embeds CB documents and writes them into the RAG store", async () => {
    const rag = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 4, modelVersion: "fake-v1" });
    const state = { lastFetchTs: 0 };
    await cbPressWorker({ adapter: fake, rag, embed, state, nowMs: 100 });
    const queryEmbedding = (await embed.embed(["Rates unchanged. Inflation pressures easing."]))[0];
    if (!queryEmbedding) throw new Error("no embedding");
    const out = await rag.search({ embedding: queryEmbedding, k: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]?.metadata.bank).toBe("FED");
    expect(state.lastFetchTs).toBe(100);
  });
});
