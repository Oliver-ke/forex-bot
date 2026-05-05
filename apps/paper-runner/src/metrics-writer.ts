import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Metrics, type Trade, computeMetrics } from "@forex-bot/eval-core";

export interface DecisionCounters {
  ticks: number;
  approved: number;
  vetoed: number;
  consensus: number;
  debated: number;
  judgeOverrideOfDebate: number;
  riskOfficerOverride: number;
}

export type SessionKey = "asia" | "london" | "ny" | "overlap_ny_london" | "off";
export type RegimeKey = "trending" | "ranging" | "event-driven" | "risk-off";

export interface SessionStats {
  trades: number;
  pnl: number;
  winRate: number;
}

export interface RegimeStats {
  trades: number;
  pnl: number;
}

export interface SessionBreakdown {
  asia: SessionStats;
  london: SessionStats;
  ny: SessionStats;
  overlap_ny_london: SessionStats;
  off: SessionStats;
}

export interface RegimeBreakdown {
  trending: RegimeStats;
  ranging: RegimeStats;
  "event-driven": RegimeStats;
  "risk-off": RegimeStats;
}

export interface DailyMetricsSnapshot {
  /** ms epoch at start of UTC day. */
  dayMs: number;
  generatedAt: number;
  metrics: Metrics;
  decisions: DecisionCounters;
  llmSpendUsd: number;
  perSession: SessionBreakdown;
  perRegime: RegimeBreakdown;
}

export interface MetricsWriterOpts {
  outDir: string;
  /** ms-epoch source, default Date.now. */
  nowFn?: () => number;
}

export interface BuildSnapshotInput {
  dayMs: number;
  cumulativeTrades: readonly Trade[];
  sessions: ReadonlyMap<Trade, SessionKey>;
  regimes: ReadonlyMap<Trade, RegimeKey>;
  decisions: DecisionCounters;
  llmSpendUsd: number;
}

export class MetricsWriter {
  private readonly outDir: string;
  private readonly nowFn: () => number;
  private dirEnsured = false;

  constructor(opts: MetricsWriterOpts) {
    this.outDir = opts.outDir;
    this.nowFn = opts.nowFn ?? Date.now;
  }

  /** Build the snapshot in memory. Trade-session and regime tagging are caller-provided. */
  buildSnapshot(input: BuildSnapshotInput): DailyMetricsSnapshot {
    const metrics = computeMetrics(input.cumulativeTrades);
    const perSession = computePerSession(input.cumulativeTrades, input.sessions);
    const perRegime = computePerRegime(input.cumulativeTrades, input.regimes);
    return {
      dayMs: input.dayMs,
      generatedAt: this.nowFn(),
      metrics,
      decisions: input.decisions,
      llmSpendUsd: input.llmSpendUsd,
      perSession,
      perRegime,
    };
  }

  /** Writes snapshot to <outDir>/metrics-YYYYMMDD.json AND appends to <outDir>/paper-summary.jsonl. */
  async flush(snapshot: DailyMetricsSnapshot): Promise<void> {
    if (!this.dirEnsured) {
      await mkdir(this.outDir, { recursive: true });
      this.dirEnsured = true;
    }
    const dateStr = formatUtcYyyymmdd(snapshot.dayMs);
    const dailyPath = join(this.outDir, `metrics-${dateStr}.json`);
    const summaryPath = join(this.outDir, "paper-summary.jsonl");
    const json = JSON.stringify(snapshot);
    await writeFile(dailyPath, `${json}\n`, "utf8");
    await appendFile(summaryPath, `${json}\n`, "utf8");
  }
}

function emptySessionBreakdown(): SessionBreakdown {
  return {
    asia: { trades: 0, pnl: 0, winRate: 0 },
    london: { trades: 0, pnl: 0, winRate: 0 },
    ny: { trades: 0, pnl: 0, winRate: 0 },
    overlap_ny_london: { trades: 0, pnl: 0, winRate: 0 },
    off: { trades: 0, pnl: 0, winRate: 0 },
  };
}

function emptyRegimeBreakdown(): RegimeBreakdown {
  return {
    trending: { trades: 0, pnl: 0 },
    ranging: { trades: 0, pnl: 0 },
    "event-driven": { trades: 0, pnl: 0 },
    "risk-off": { trades: 0, pnl: 0 },
  };
}

function computePerSession(
  trades: readonly Trade[],
  sessions: ReadonlyMap<Trade, SessionKey>,
): SessionBreakdown {
  const out = emptySessionBreakdown();
  // Track wins per bucket, then derive winRate at end.
  const wins: Record<SessionKey, number> = {
    asia: 0,
    london: 0,
    ny: 0,
    overlap_ny_london: 0,
    off: 0,
  };
  for (const t of trades) {
    const key = sessions.get(t) ?? "off";
    const bucket = out[key];
    bucket.trades += 1;
    bucket.pnl += t.pnl;
    if (t.pnl > 0) wins[key] += 1;
  }
  for (const k of Object.keys(out) as SessionKey[]) {
    const bucket = out[k];
    bucket.winRate = bucket.trades > 0 ? wins[k] / bucket.trades : 0;
  }
  return out;
}

function computePerRegime(
  trades: readonly Trade[],
  regimes: ReadonlyMap<Trade, RegimeKey>,
): RegimeBreakdown {
  const out = emptyRegimeBreakdown();
  for (const t of trades) {
    const key = regimes.get(t);
    if (!key) continue;
    const bucket = out[key];
    bucket.trades += 1;
    bucket.pnl += t.pnl;
  }
  return out;
}

function formatUtcYyyymmdd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}
