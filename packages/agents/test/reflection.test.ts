import type { TradeJournal, TradeOutcome } from "@forex-bot/contracts";
import type { RagDoc } from "@forex-bot/data-core";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { reflect } from "../src/reflection.js";

const journal: TradeJournal = {
  tradeId: "t-1",
  symbol: "EURUSD",
  openedAt: 1,
  verdict: { direction: "long", confidence: 0.7, horizon: "H1", reasoning: "trend continuation" },
  risk: { approve: true, lotSize: 0.1, sl: 1.07, tp: 1.09, expiresAt: 0, reasons: ["ok"] },
};

const outcomeWin: TradeOutcome = {
  closedAt: 100,
  pnl: 75,
  realizedR: 1.5,
  mae: 5,
  mfe: 75,
  exitReason: "tp",
};

const ragHits: RagDoc[] = [
  {
    id: "t-99",
    text: "previous trend-continuation long on EURUSD: tp hit",
    embedding: [1, 0],
    modelVersion: "fake-v1",
    metadata: { regime: "trending", outcome: "tp" },
    ts: 0,
  },
];

describe("reflect", () => {
  it("invokes Opus 4.7 with the reflection prompt", async () => {
    const llm = new FakeLlm({
      route: () => ({
        lesson: "Trend continuation in normal vol works when ADX > 25.",
        tags: ["regime:trending", "outcome:tp"],
        confidence: 0.7,
      }),
    });
    const out = await reflect({ journal, outcome: outcomeWin, ragHits, llm });
    expect(out.lesson).toContain("ADX");
    expect(out.tags).toContain("regime:trending");
    expect(llm.calls[0]?.model).toBe("claude-opus-4-7");
  });
});
