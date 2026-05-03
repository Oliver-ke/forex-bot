import { describe, expect, it } from "vitest";
import { computeMetrics } from "../src/metrics.js";
import type { Trade } from "../src/types.js";

function trade(pnl: number, R: number, exitReason: Trade["exitReason"] = "tp"): Trade {
  return {
    symbol: "EURUSD",
    openedAt: 0,
    closedAt: 1,
    side: "buy",
    entry: 1,
    sl: 0.99,
    tp: 1.02,
    exit: 1.01,
    lotSize: 0.1,
    pnl,
    realizedR: R,
    exitReason,
    verdict: { direction: "long", confidence: 0.5, horizon: "H1", reasoning: "x" },
    decision: { approve: true, lotSize: 0.1, sl: 0.99, tp: 1.02, expiresAt: 0, reasons: ["ok"] },
  };
}

describe("computeMetrics", () => {
  it("computes profit factor, win rate, expectancy on a known set", () => {
    const m = computeMetrics([trade(10, 1), trade(-5, -1), trade(15, 1.5), trade(-5, -1)]);
    expect(m.winRate).toBeCloseTo(0.5, 5);
    expect(m.profitFactor).toBeCloseTo(25 / 10, 5);
    expect(m.expectancyR).toBeCloseTo((1 + -1 + 1.5 + -1) / 4, 5);
    expect(m.tradeCount).toBe(4);
  });

  it("returns NaN-safe values when there are no trades", () => {
    const m = computeMetrics([]);
    expect(m.tradeCount).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
  });

  it("computes Sharpe from equity returns when daily series is supplied", () => {
    const m = computeMetrics([], {
      dailyEquity: [
        { ts: 0, equity: 10_000, drawdown: 0 },
        { ts: 86_400_000, equity: 10_100, drawdown: 0 },
        { ts: 2 * 86_400_000, equity: 10_050, drawdown: 0.005 },
        { ts: 3 * 86_400_000, equity: 10_200, drawdown: 0 },
      ],
    });
    expect(m.sharpe).toBeGreaterThan(0);
  });
});
