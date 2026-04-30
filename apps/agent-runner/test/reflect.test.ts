import type { TradeJournal, TradeOutcome } from "@forex-bot/contracts";
import {
  FakeEmbeddingProvider,
  InMemoryJournalStore,
  InMemoryRagStore,
} from "@forex-bot/data-core";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { reflectOnClose } from "../src/reflect.js";

const journal: TradeJournal = {
  tradeId: "trade-1",
  symbol: "EURUSD",
  openedAt: 1_700_000_000_000,
  analysts: [],
  verdict: {
    direction: "long",
    confidence: 0.7,
    horizon: "H1",
    reasoning: "trend continuation on H1; ADX rising",
    debated: false,
  },
  risk: {
    approve: true,
    lotSize: 0.05,
    sl: 1.075,
    tp: 1.0875,
    expiresAt: 1_700_000_300_000,
    reasons: ["risk: ok"],
  },
};

const outcome: TradeOutcome = {
  closedAt: 1_700_000_100_000,
  pnl: 25,
  realizedR: 0.5,
  mae: 5,
  mfe: 30,
  exitReason: "tp",
};

describe("reflectOnClose", () => {
  it("calls reflection agent with RAG hits and writes the updated journal", async () => {
    const journalStore = new InMemoryJournalStore();
    const rag = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 8, modelVersion: "fake-1" });
    const llm = new FakeLlm({
      route: () => ({
        lesson: "Trend setups in normal vol regime hit TP cleanly when ADX > 25.",
        tags: ["trending", "ADX", "EURUSD"],
        confidence: 0.7,
      }),
    });

    const out = await reflectOnClose({
      journal,
      outcome,
      llm,
      journalStore,
      rag,
      embed,
    });

    expect(out.lesson.lesson).toMatch(/ADX/);
    expect(llm.calls[0]?.model).toBe("claude-opus-4-7");

    const stored = await journalStore.get("trade-1");
    expect(stored?.outcome).toEqual(outcome);
  });
});
