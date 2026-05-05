import type { EquityPoint, ReplayReport, Trade } from "@forex-bot/eval-core";
import { describe, expect, it } from "vitest";
import { formatJson, formatMarkdown } from "../src/report.js";

const HOUR_MS = 60 * 60_000;
const T0 = Date.UTC(2024, 0, 2, 9, 0, 0);

function makeTrade(
  symbol: string,
  openOffsetH: number,
  closeOffsetH: number,
  side: "buy" | "sell",
  entry: number,
  exit: number,
  pnl: number,
  realizedR: number,
  exitReason: Trade["exitReason"],
): Trade {
  return {
    symbol,
    openedAt: T0 + openOffsetH * HOUR_MS,
    closedAt: T0 + closeOffsetH * HOUR_MS,
    side,
    entry,
    sl: side === "buy" ? entry - 0.005 : entry + 0.005,
    tp: side === "buy" ? entry + 0.01 : entry - 0.01,
    exit,
    lotSize: 0.05,
    pnl,
    realizedR,
    exitReason,
    verdict: {
      direction: side === "buy" ? "long" : "short",
      confidence: 0.75,
      horizon: "H1",
      reasoning: "fixture",
    },
    decision: {
      approve: true,
      lotSize: 0.05,
      sl: side === "buy" ? entry - 0.005 : entry + 0.005,
      tp: side === "buy" ? entry + 0.01 : entry - 0.01,
      expiresAt: T0 + 24 * HOUR_MS,
      reasons: ["ok"],
    },
  };
}

function buildReport(): ReplayReport {
  const trades: readonly Trade[] = [
    makeTrade("EURUSD", 0, 2, "buy", 1.08, 1.09, 100, 2, "tp"),
    makeTrade("EURUSD", 3, 5, "buy", 1.09, 1.085, -50, -1, "sl"),
    makeTrade("USDJPY", 4, 7, "sell", 150.0, 149.5, 75, 1.5, "tp"),
  ];
  const equity: readonly EquityPoint[] = [
    { ts: T0, equity: 10_000, drawdown: 0 },
    { ts: T0 + 24 * HOUR_MS, equity: 10_125, drawdown: 0 },
  ];
  return {
    generatedAt: T0 + 25 * HOUR_MS,
    window: { startMs: T0, endMs: T0 + 24 * HOUR_MS },
    symbols: ["EURUSD", "USDJPY"],
    trades,
    equity,
    metrics: {
      tradeCount: 3,
      winRate: 2 / 3,
      profitFactor: 175 / 50,
      expectancyR: (2 + -1 + 1.5) / 3,
      avgWinR: (2 + 1.5) / 2,
      avgLossR: -1,
      maxDrawdownPct: 0,
      sharpe: 1.23,
    },
    llmCacheStats: { hits: 7, misses: 3 },
    journals: [],
  };
}

describe("formatMarkdown", () => {
  it("renders header, metrics, and all 3 trades", () => {
    const report = buildReport();
    const md = formatMarkdown(report);

    expect(md).toContain("# Replay Report");
    // Trade count value rendered in metrics table
    expect(md).toContain("| Trade count | 3 |");
    // Profit factor matches the metric (175/50 = 3.50)
    expect(md).toContain("| Profit factor | 3.50 |");

    // All 3 trades rendered (since 3 < 50)
    for (const t of report.trades) {
      expect(md).toContain(t.symbol);
      expect(md).toContain(new Date(t.closedAt).toISOString());
    }

    // LLM cache stats line
    expect(md).toContain("Cache: 7 hits / 3 misses");
    expect(md).toContain("70.0%");

    // Per-session placeholder TODO comment
    expect(md).toContain("<!-- per-session: TODO -->");
  });

  it("includes per-symbol breakdown with correct counts", () => {
    const report = buildReport();
    const md = formatMarkdown(report);

    // EURUSD: 2 trades, 1 win → 50.0% winRate, expectancy = (2 + -1)/2 = 0.50
    expect(md).toMatch(/EURUSD[^\n]*\|\s*2\s*\|/);
    expect(md).toMatch(/EURUSD[^\n]*\|\s*50\.0%\s*\|/);
    expect(md).toMatch(/EURUSD[^\n]*\|\s*0\.50\s*\|/);

    // USDJPY: 1 trade, 1 win → 100.0%, expectancy = 1.50
    expect(md).toMatch(/USDJPY[^\n]*\|\s*1\s*\|/);
    expect(md).toMatch(/USDJPY[^\n]*\|\s*100\.0%\s*\|/);
    expect(md).toMatch(/USDJPY[^\n]*\|\s*1\.50\s*\|/);
  });

  it('handles empty report and shows "No trades."', () => {
    const empty: ReplayReport = {
      generatedAt: T0,
      window: { startMs: T0, endMs: T0 },
      symbols: [],
      trades: [],
      equity: [],
      metrics: {
        tradeCount: 0,
        winRate: 0,
        profitFactor: 0,
        expectancyR: 0,
        avgWinR: 0,
        avgLossR: 0,
        maxDrawdownPct: 0,
        sharpe: 0,
      },
      journals: [],
    };
    expect(() => formatMarkdown(empty)).not.toThrow();
    const md = formatMarkdown(empty);
    expect(md).toContain("No trades.");
  });
});

describe("formatJson", () => {
  it("parses back and has stable top-level key order", () => {
    const report = buildReport();
    const json = formatJson(report);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      "generatedAt",
      "window",
      "symbols",
      "metrics",
      "llmCacheStats",
      "trades",
      "equity",
      "journals",
    ]);
  });

  it("preserves key order even when llmCacheStats is absent", () => {
    const report = buildReport();
    const { llmCacheStats: _omit, ...rest } = report;
    const without: ReplayReport = rest;
    const json = formatJson(without);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // JSON.stringify drops `undefined` values; ensure remaining keys still ordered.
    const keys = Object.keys(parsed);
    const idx = (k: string) => keys.indexOf(k);
    expect(idx("generatedAt")).toBeLessThan(idx("window"));
    expect(idx("window")).toBeLessThan(idx("symbols"));
    expect(idx("symbols")).toBeLessThan(idx("metrics"));
    expect(idx("metrics")).toBeLessThan(idx("trades"));
    expect(idx("trades")).toBeLessThan(idx("equity"));
    expect(idx("equity")).toBeLessThan(idx("journals"));
  });
});
