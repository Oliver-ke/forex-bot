import { describe, expect, it } from "vitest";
import type { Position } from "@forex-bot/contracts";
import { CorrelationMatrix, netCorrelatedRiskPct } from "../src/correlation.js";

const M = new CorrelationMatrix({
  EURUSD: { GBPUSD: 0.8, USDJPY: -0.6 },
  GBPUSD: { EURUSD: 0.8, USDJPY: -0.5 },
  USDJPY: { EURUSD: -0.6, GBPUSD: -0.5 },
});

function pos(symbol: "EURUSD" | "GBPUSD" | "USDJPY", side: "buy" | "sell", lot: number): Position {
  return {
    id: `${symbol}-${side}`,
    symbol,
    side,
    lotSize: lot,
    entry: 1,
    sl: side === "buy" ? 0.9 : 1.1,
    tp: side === "buy" ? 1.1 : 0.9,
    openedAt: 0,
  };
}

describe("correlation", () => {
  it("two highly-correlated longs summed as same-direction exposure", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("GBPUSD", "buy", 0.1)],
      positionRiskPct: () => 1,
      threshold: 0.6,
    });
    expect(risk).toBeGreaterThanOrEqual(2);
  });

  it("opposite direction correlated trades offset", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("GBPUSD", "sell", 0.1)],
      positionRiskPct: () => 1,
      threshold: 0.6,
    });
    expect(risk).toBeCloseTo(0, 6);
  });

  it("uncorrelated pair does not contribute", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("USDJPY", "buy", 0.1)],
      positionRiskPct: () => 1,
      threshold: 0.6,
    });
    expect(Math.abs(risk)).toBeCloseTo(0, 6);
  });

  it("same-symbol correlation is 1; missing pair is 0", () => {
    expect(M.corr("EURUSD", "EURUSD")).toBe(1);
    // pair not present in matrix data
    expect(M.corr("USDCHF", "AUDUSD")).toBe(0);
  });

  it("sell-side new trade flips the sign correctly", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "sell",
      newRiskPct: 1,
      openPositions: [pos("GBPUSD", "buy", 0.1)],
      positionRiskPct: () => 1,
      threshold: 0.6,
    });
    // new short EURUSD (-1) + GBPUSD long with corr 0.8 (+1) → net = -1 + 1 = 0
    expect(risk).toBeCloseTo(0, 6);
  });

  it("ignores positions below threshold", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("GBPUSD", "buy", 0.1)],
      positionRiskPct: () => 1,
      threshold: 0.95, // 0.8 < 0.95 → ignored
    });
    expect(risk).toBe(1);
  });
});
