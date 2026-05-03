import type { RiskDecision, Symbol, TradeJournal, TradeOutcome, Verdict } from "@forex-bot/contracts";
import type { Metrics } from "./metrics.js";

export interface Trade {
  symbol: Symbol;
  openedAt: number;
  closedAt: number;
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
  exit: number;
  lotSize: number;
  pnl: number;
  realizedR: number;
  exitReason: TradeOutcome["exitReason"];
  verdict: Verdict;
  decision: RiskDecision;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  drawdown: number;
}

export interface ReplayReport {
  generatedAt: number;
  window: { startMs: number; endMs: number };
  symbols: readonly Symbol[];
  trades: readonly Trade[];
  equity: readonly EquityPoint[];
  metrics: Metrics;
  llmCacheStats?: { hits: number; misses: number };
  journals: readonly TradeJournal[];
}
