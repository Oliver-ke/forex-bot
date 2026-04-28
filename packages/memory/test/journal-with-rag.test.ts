import {
  FakeEmbeddingProvider,
  InMemoryJournalStore,
  InMemoryRagStore,
} from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { writeJournalWithRag } from "../src/journal-with-rag.js";

describe("writeJournalWithRag", () => {
  it("writes the journal and embeds rationale into the rag store", async () => {
    const journal = new InMemoryJournalStore();
    const rag = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 8, modelVersion: "fake-v1" });

    await writeJournalWithRag(
      {
        tradeId: "t-1",
        symbol: "EURUSD",
        openedAt: 1,
        verdict: { direction: "long", confidence: 0.8, horizon: "H1", reasoning: "trend continuation" },
        risk: {
          approve: true,
          lotSize: 0.1,
          sl: 1.07,
          tp: 1.09,
          expiresAt: 0,
          reasons: ["confluence"],
        },
      },
      { journal, rag, embed, regime: "trending" },
    );

    expect((await journal.get("t-1"))?.tradeId).toBe("t-1");
    const queryEmbedding = (await embed.embed(["trend continuation"]))[0];
    if (!queryEmbedding) throw new Error("no embedding");
    const hits = await rag.search({ embedding: queryEmbedding, k: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.metadata.regime).toBe("trending");
    expect(hits[0]?.id).toBe("t-1");
  });
});
