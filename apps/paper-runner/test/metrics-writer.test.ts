import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Trade } from "@forex-bot/eval-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DailyMetricsSnapshot,
  type DecisionCounters,
  MetricsWriter,
  type RegimeBreakdown,
  type SessionBreakdown,
} from "../src/metrics-writer.js";

function trade(pnl: number, R: number, openedAt = 0, closedAt = 1): Trade {
  return {
    symbol: "EURUSD",
    openedAt,
    closedAt,
    side: "buy",
    entry: 1,
    sl: 0.99,
    tp: 1.02,
    exit: 1.01,
    lotSize: 0.1,
    pnl,
    realizedR: R,
    exitReason: "tp",
    verdict: { direction: "long", confidence: 0.5, horizon: "H1", reasoning: "x" },
    decision: { approve: true, lotSize: 0.1, sl: 0.99, tp: 1.02, expiresAt: 0, reasons: ["ok"] },
  };
}

function emptyDecisions(): DecisionCounters {
  return {
    ticks: 100,
    approved: 5,
    vetoed: 2,
    consensus: 3,
    debated: 4,
    judgeOverrideOfDebate: 1,
    riskOfficerOverride: 0,
  };
}

describe("MetricsWriter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "metrics-writer-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("buildSnapshot computes metrics, per-session, per-regime, decisions, llmSpendUsd", () => {
    const t1 = trade(10, 1);
    const t2 = trade(-5, -1);
    const t3 = trade(20, 2);
    const cumulativeTrades: readonly Trade[] = [t1, t2, t3];

    const sessions: ReadonlyMap<Trade, keyof SessionBreakdown> = new Map([
      [t1, "london"],
      [t2, "london"],
      [t3, "ny"],
    ] as const);
    const regimes: ReadonlyMap<Trade, keyof RegimeBreakdown> = new Map([
      [t1, "trending"],
      [t2, "ranging"],
      [t3, "trending"],
    ] as const);

    // 2026-02-02 UTC = Date.UTC(2026, 1, 2)
    const dayMs = Date.UTC(2026, 1, 2);

    const writer = new MetricsWriter({ outDir: dir, nowFn: () => 1_700_000_000_000 });
    const snap = writer.buildSnapshot({
      dayMs,
      cumulativeTrades,
      sessions,
      regimes,
      decisions: emptyDecisions(),
      llmSpendUsd: 4.25,
    });

    expect(snap.dayMs).toBe(dayMs);
    expect(snap.generatedAt).toBe(1_700_000_000_000);
    expect(snap.metrics.tradeCount).toBe(3);
    expect(snap.metrics.winRate).toBeCloseTo(2 / 3, 5);
    expect(snap.llmSpendUsd).toBe(4.25);
    expect(snap.decisions).toEqual(emptyDecisions());

    // London: t1(+10), t2(-5) → 2 trades, pnl=5, winRate=0.5
    expect(snap.perSession.london.trades).toBe(2);
    expect(snap.perSession.london.pnl).toBeCloseTo(5, 5);
    expect(snap.perSession.london.winRate).toBeCloseTo(0.5, 5);
    // NY: t3(+20) → 1 trade, pnl=20, winRate=1
    expect(snap.perSession.ny.trades).toBe(1);
    expect(snap.perSession.ny.pnl).toBeCloseTo(20, 5);
    expect(snap.perSession.ny.winRate).toBeCloseTo(1, 5);
    // Untouched buckets are zeroed.
    expect(snap.perSession.asia).toEqual({ trades: 0, pnl: 0, winRate: 0 });
    expect(snap.perSession.overlap_ny_london).toEqual({ trades: 0, pnl: 0, winRate: 0 });
    expect(snap.perSession.off).toEqual({ trades: 0, pnl: 0, winRate: 0 });

    // Trending: t1(+10), t3(+20) → trades=2, pnl=30
    expect(snap.perRegime.trending).toEqual({ trades: 2, pnl: 30 });
    // Ranging: t2(-5) → trades=1, pnl=-5
    expect(snap.perRegime.ranging).toEqual({ trades: 1, pnl: -5 });
    expect(snap.perRegime["event-driven"]).toEqual({ trades: 0, pnl: 0 });
    expect(snap.perRegime["risk-off"]).toEqual({ trades: 0, pnl: 0 });
  });

  it("flush writes metrics-YYYYMMDD.json and appends a JSONL line; second flush appends another", async () => {
    const writer = new MetricsWriter({ outDir: dir });
    const dayMs = Date.UTC(2026, 1, 2); // 2026-02-02

    const snapshot: DailyMetricsSnapshot = {
      dayMs,
      generatedAt: 1_700_000_000_000,
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
      decisions: emptyDecisions(),
      llmSpendUsd: 0,
      perSession: {
        asia: { trades: 0, pnl: 0, winRate: 0 },
        london: { trades: 0, pnl: 0, winRate: 0 },
        ny: { trades: 0, pnl: 0, winRate: 0 },
        overlap_ny_london: { trades: 0, pnl: 0, winRate: 0 },
        off: { trades: 0, pnl: 0, winRate: 0 },
      },
      perRegime: {
        trending: { trades: 0, pnl: 0 },
        ranging: { trades: 0, pnl: 0 },
        "event-driven": { trades: 0, pnl: 0 },
        "risk-off": { trades: 0, pnl: 0 },
      },
    };

    await writer.flush(snapshot);

    const dailyPath = join(dir, "metrics-20260202.json");
    const dailyJson = JSON.parse(await readFile(dailyPath, "utf8"));
    expect(dailyJson).toEqual(snapshot);

    const summaryPath = join(dir, "paper-summary.jsonl");
    const summary1 = await readFile(summaryPath, "utf8");
    expect(summary1.endsWith("\n")).toBe(true);
    const lines1 = summary1.trim().split("\n");
    expect(lines1).toHaveLength(1);
    expect(JSON.parse(lines1[0] as string)).toEqual(snapshot);

    // Second flush appends another line.
    const snapshot2: DailyMetricsSnapshot = {
      ...snapshot,
      generatedAt: 1_700_000_000_001,
      llmSpendUsd: 1.5,
    };
    await writer.flush(snapshot2);

    const summary2 = await readFile(summaryPath, "utf8");
    const lines2 = summary2.trim().split("\n");
    expect(lines2).toHaveLength(2);
    expect(JSON.parse(lines2[0] as string)).toEqual(snapshot);
    expect(JSON.parse(lines2[1] as string)).toEqual(snapshot2);
  });

  it("formats date in UTC for snapshots near midnight boundaries", async () => {
    const writer = new MetricsWriter({ outDir: dir });
    // 2025-12-31T00:00:00Z
    const dayMs = Date.UTC(2025, 11, 31);

    const snap: DailyMetricsSnapshot = {
      dayMs,
      generatedAt: 0,
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
      decisions: emptyDecisions(),
      llmSpendUsd: 0,
      perSession: {
        asia: { trades: 0, pnl: 0, winRate: 0 },
        london: { trades: 0, pnl: 0, winRate: 0 },
        ny: { trades: 0, pnl: 0, winRate: 0 },
        overlap_ny_london: { trades: 0, pnl: 0, winRate: 0 },
        off: { trades: 0, pnl: 0, winRate: 0 },
      },
      perRegime: {
        trending: { trades: 0, pnl: 0 },
        ranging: { trades: 0, pnl: 0 },
        "event-driven": { trades: 0, pnl: 0 },
        "risk-off": { trades: 0, pnl: 0 },
      },
    };

    await writer.flush(snap);

    const out = await readFile(join(dir, "metrics-20251231.json"), "utf8");
    expect(JSON.parse(out)).toEqual(snap);
  });
});
