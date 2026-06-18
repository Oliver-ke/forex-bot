import type { AccuracyScore } from "./accuracy.js";
import type { Metrics } from "./metrics.js";

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
  accuracy: AccuracyScore;
  decisions: DecisionCounters;
  llmSpendUsd: number;
  perSession: SessionBreakdown;
  perRegime: RegimeBreakdown;
}

export interface MetricsStore {
  put(snapshot: DailyMetricsSnapshot): Promise<void>;
  getDay(dayMs: number): Promise<DailyMetricsSnapshot | undefined>;
  list(opts: {
    limit: number;
    cursor?: string;
  }): Promise<{ items: readonly DailyMetricsSnapshot[]; nextCursor?: string }>;
}
