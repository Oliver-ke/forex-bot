import { describe, expect, it } from "vitest";
import { buildEquityCurve } from "../src/equity-curve.js";
import type { Trade } from "../src/types.js";

const DAY = 86_400_000;

function trade(pnl: number, closedAt: number): Trade {
  return {
    symbol: "EURUSD",
    openedAt: closedAt - 1,
    closedAt,
    side: "buy",
    entry: 1,
    sl: 0.99,
    tp: 1.02,
    exit: 1.01,
    lotSize: 0.1,
    pnl,
    realizedR: pnl > 0 ? 1 : -1,
    exitReason: pnl > 0 ? "tp" : "sl",
    verdict: { direction: "long", confidence: 0.5, horizon: "H1", reasoning: "x" },
    decision: {
      approve: true,
      lotSize: 0.1,
      sl: 0.99,
      tp: 1.02,
      expiresAt: 0,
      reasons: ["ok"],
    },
  };
}

describe("buildEquityCurve", () => {
  it("returns a single starting point when there are no trades", () => {
    const out = buildEquityCurve(10_000, [], { stepMs: DAY });
    expect(out).toEqual([{ ts: 0, equity: 10_000, drawdown: 0 }]);
  });

  it("walks day buckets, accumulates pnl, and tracks drawdown peak", () => {
    const trades: Trade[] = [trade(+100, 1 * DAY), trade(-50, 3 * DAY), trade(+25, 5 * DAY)];
    const out = buildEquityCurve(10_000, trades, { stepMs: DAY });

    // Buckets from day 1 to day 5 inclusive => 5 entries.
    expect(out.length).toBe(5);

    // Day 1: +100 cum.
    expect(out[0]?.ts).toBe(1 * DAY);
    expect(out[0]?.equity).toBe(10_100);
    expect(out[0]?.drawdown).toBe(0);

    // Day 2: still +100 (no new trades).
    expect(out[1]?.ts).toBe(2 * DAY);
    expect(out[1]?.equity).toBe(10_100);
    expect(out[1]?.drawdown).toBe(0);

    // Day 3: -50 lands -> cum +50, peak still 10_100.
    expect(out[2]?.ts).toBe(3 * DAY);
    expect(out[2]?.equity).toBe(10_050);
    expect(out[2]?.drawdown).toBeCloseTo(50 / 10_100, 10);

    // Day 4: same as day 3.
    expect(out[3]?.ts).toBe(4 * DAY);
    expect(out[3]?.equity).toBe(10_050);
    expect(out[3]?.drawdown).toBeCloseTo(50 / 10_100, 10);

    // Day 5: +25 -> cum +75, new peak 10_075 (still below old peak so dd > 0).
    expect(out[4]?.ts).toBe(5 * DAY);
    expect(out[4]?.equity).toBe(10_075);
    expect(out[4]?.drawdown).toBeCloseTo(25 / 10_100, 10);
  });

  it("includes a trade closed exactly on a bucket boundary in that bucket", () => {
    const trades: Trade[] = [trade(+200, 2 * DAY)];
    const out = buildEquityCurve(1_000, trades, { stepMs: DAY });

    expect(out.length).toBe(1);
    expect(out[0]?.ts).toBe(2 * DAY);
    expect(out[0]?.equity).toBe(1_200);
    expect(out[0]?.drawdown).toBe(0);
  });
});
