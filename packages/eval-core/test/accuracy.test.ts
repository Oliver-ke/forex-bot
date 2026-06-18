import { describe, expect, it } from "vitest";
import { scoreAccuracy } from "../src/accuracy.js";
import { computeMetrics } from "../src/metrics.js";
import type { Trade } from "../src/types.js";

/** Minimal trade helper — sets only the fields scoreAccuracy reads. */
function trade(opts: {
  direction: "long" | "short" | "neutral";
  entry: number;
  exit: number;
  pnl: number;
  realizedR: number;
}): Trade {
  return {
    symbol: "EURUSD",
    openedAt: 0,
    closedAt: 1,
    side: opts.direction === "short" ? "sell" : "buy",
    entry: opts.entry,
    sl: opts.direction === "short" ? opts.entry + 0.01 : opts.entry - 0.01,
    tp: opts.direction === "short" ? opts.entry - 0.02 : opts.entry + 0.02,
    exit: opts.exit,
    lotSize: 0.1,
    pnl: opts.pnl,
    realizedR: opts.realizedR,
    exitReason: "tp",
    verdict: { direction: opts.direction, confidence: 0.8, horizon: "H1", reasoning: "x" },
    decision: { approve: true, lotSize: 0.1, sl: 0, tp: 0, expiresAt: 0, reasons: ["ok"] },
  };
}

describe("scoreAccuracy", () => {
  it("empty trades → all zeros", () => {
    expect(scoreAccuracy([])).toEqual({ directionalHitRate: 0, winRate: 0, expectancyR: 0 });
  });

  it("3 hits and 1 miss out of 4 directional trades → directionalHitRate ≈ 0.75", () => {
    const trades: readonly Trade[] = [
      // long hit: exit > entry
      trade({ direction: "long", entry: 1.08, exit: 1.09, pnl: 10, realizedR: 1 }),
      // long hit: exit > entry
      trade({ direction: "long", entry: 1.08, exit: 1.085, pnl: 5, realizedR: 0.5 }),
      // short hit: exit < entry
      trade({ direction: "short", entry: 1.08, exit: 1.07, pnl: 10, realizedR: 1 }),
      // long miss: exit < entry
      trade({ direction: "long", entry: 1.08, exit: 1.075, pnl: -5, realizedR: -1 }),
    ];
    const result = scoreAccuracy(trades);
    expect(result.directionalHitRate).toBeCloseTo(0.75, 5);
  });

  it("neutral verdict trades are excluded from directional denominator", () => {
    const trades: readonly Trade[] = [
      // long hit
      trade({ direction: "long", entry: 1.08, exit: 1.09, pnl: 10, realizedR: 1 }),
      // neutral — excluded from denominator
      trade({ direction: "neutral", entry: 1.08, exit: 1.075, pnl: -5, realizedR: -0.5 }),
    ];
    const result = scoreAccuracy(trades);
    // Only 1 directional trade (the long hit) → 1/1 = 1.0
    expect(result.directionalHitRate).toBe(1);
  });

  it("winRate and expectancyR delegate to computeMetrics — values must match", () => {
    const trades: readonly Trade[] = [
      trade({ direction: "long", entry: 1.08, exit: 1.09, pnl: 10, realizedR: 1 }),
      trade({ direction: "short", entry: 1.08, exit: 1.07, pnl: 10, realizedR: 1 }),
      trade({ direction: "long", entry: 1.08, exit: 1.075, pnl: -5, realizedR: -1 }),
      trade({ direction: "neutral", entry: 1.08, exit: 1.085, pnl: 5, realizedR: 0.5 }),
    ];
    const m = computeMetrics(trades);
    const result = scoreAccuracy(trades);
    expect(result.winRate).toBe(m.winRate);
    expect(result.expectancyR).toBe(m.expectancyR);
  });

  it("all directional trades are misses → directionalHitRate === 0", () => {
    const trades: readonly Trade[] = [
      // long miss: exit < entry
      trade({ direction: "long", entry: 1.08, exit: 1.07, pnl: -10, realizedR: -1 }),
      // short miss: exit > entry
      trade({ direction: "short", entry: 1.08, exit: 1.09, pnl: -10, realizedR: -1 }),
    ];
    expect(scoreAccuracy(trades).directionalHitRate).toBe(0);
  });

  it("only neutral trades → directionalHitRate === 0 (no directional denominator)", () => {
    const trades: readonly Trade[] = [
      trade({ direction: "neutral", entry: 1.08, exit: 1.09, pnl: 5, realizedR: 0.5 }),
      trade({ direction: "neutral", entry: 1.08, exit: 1.07, pnl: -5, realizedR: -0.5 }),
    ];
    expect(scoreAccuracy(trades).directionalHitRate).toBe(0);
  });
});
