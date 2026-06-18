import type { Candle, StateBundle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { buildGateContext } from "../src/gate-context.js";

// Dates verified with getUTCDay():
//   Date.UTC(2026, 4, 16, 12) → 2026-05-16T12:00:00Z, DOW=6 (Saturday) → off
//   Date.UTC(2026, 4, 18, 10) → 2026-05-18T10:00:00Z, DOW=1 (Monday)   → london
//   Date.UTC(2026, 4, 18, 13) → 2026-05-18T13:00:00Z, DOW=1 (Monday)   → overlap_ny_london

const HOUR_MS = 60 * 60_000;

function bar(ts: number, close: number): Candle {
  const pip = 0.0001;
  return { ts, open: close, high: close + 5 * pip, low: close - 5 * pip, close, volume: 1 };
}

function buildBars(count: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    out.push(bar(Date.UTC(2026, 4, 10) + i * HOUR_MS, 1.08 + i * 0.0001));
  }
  return out;
}

const ACCOUNT = {
  ts: Date.UTC(2026, 4, 18, 10),
  currency: "USD" as const,
  balance: 10_000,
  equity: 10_100,
  freeMargin: 9_000,
  usedMargin: 1_000,
  marginLevelPct: 1010,
};

function makeBundle(h1Bars: Candle[]): StateBundle {
  const bars1 = h1Bars.length > 0 ? h1Bars : buildBars(20);
  return {
    symbol: "EURUSD",
    ts: Date.UTC(2026, 4, 18, 10),
    trigger: { reason: "schedule" },
    market: {
      symbol: "EURUSD",
      M15: buildBars(20),
      H1: bars1,
      H4: buildBars(20),
      D1: buildBars(20),
    },
    account: ACCOUNT,
    openPositions: [],
    recentNews: [],
    upcomingEvents: [],
    regimePrior: { label: "ranging", volBucket: "normal" },
  };
}

describe("buildGateContext", () => {
  it("weekend (Saturday DOW=6) → ctx.session === 'off'", () => {
    // Date.UTC(2026, 4, 16, 12) → 2026-05-16T12:00:00Z, DOW=6 (Saturday)
    const now = Date.UTC(2026, 4, 16, 12);
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(20)),
    });
    expect(ctx.session).toBe("off");
  });

  it("weekday active hour (Monday 10:00 UTC, DOW=1) → ctx.session === 'london'", () => {
    // Date.UTC(2026, 4, 18, 10) → 2026-05-18T10:00:00Z, DOW=1 (Monday)
    const now = Date.UTC(2026, 4, 18, 10);
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(20)),
    });
    expect(ctx.session).toBe("london");
  });

  it("weekday overlap hour (Monday 13:00 UTC, DOW=1) → ctx.session === 'overlap_ny_london'", () => {
    // Date.UTC(2026, 4, 18, 13) → 2026-05-18T13:00:00Z, DOW=1 (Monday)
    const now = Date.UTC(2026, 4, 18, 13);
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(20)),
    });
    expect(ctx.session).toBe("overlap_ny_london");
  });

  it("ctx.pipValuePerLot('EURUSD') === 10", () => {
    const now = Date.UTC(2026, 4, 18, 10);
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(20)),
    });
    expect(ctx.pipValuePerLot("EURUSD")).toBe(10);
  });

  it("ctx.pipValuePerLot('USDJPY') ≈ 6–7 (1000/150)", () => {
    const now = Date.UTC(2026, 4, 18, 10);
    const ctx = buildGateContext({
      now,
      symbol: "USDJPY",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(20)),
    });
    const val = ctx.pipValuePerLot("USDJPY");
    expect(val).toBeGreaterThan(6);
    expect(val).toBeLessThan(7);
  });

  it("bundle with ≥15 H1 bars → ctx.atrPips > 0", () => {
    const now = Date.UTC(2026, 4, 18, 10);
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(20)),
    });
    expect(ctx.atrPips).toBeGreaterThan(0);
  });

  it("bundle with < 15 H1 bars → ctx.atrPips === 20 (fallback)", () => {
    const now = Date.UTC(2026, 4, 18, 10);
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account: ACCOUNT,
      bundle: makeBundle(buildBars(10)),
    });
    expect(ctx.atrPips).toBe(20);
  });

  it("ctx.account.equity equals the passed-in account's equity (passthrough)", () => {
    const now = Date.UTC(2026, 4, 18, 10);
    const account = { ...ACCOUNT, equity: 12_345 };
    const ctx = buildGateContext({
      now,
      symbol: "EURUSD",
      account,
      bundle: makeBundle(buildBars(20)),
    });
    expect(ctx.account.equity).toBe(12_345);
  });
});
