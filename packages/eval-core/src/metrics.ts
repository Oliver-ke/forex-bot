import type { EquityPoint, Trade } from "./types.js";

export interface Metrics {
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  maxDrawdownPct: number;
  sharpe: number;
}

export interface ComputeMetricsOpts {
  dailyEquity?: readonly EquityPoint[];
  riskFreeRatePerDay?: number;
}

export function computeMetrics(trades: readonly Trade[], opts: ComputeMetricsOpts = {}): Metrics {
  if (trades.length === 0) {
    return {
      tradeCount: 0,
      winRate: 0,
      profitFactor: 0,
      expectancyR: 0,
      avgWinR: 0,
      avgLossR: 0,
      maxDrawdownPct: 0,
      sharpe: opts.dailyEquity
        ? sharpeFromEquity(opts.dailyEquity, opts.riskFreeRatePerDay ?? 0)
        : 0,
    };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const expectancyR = trades.reduce((s, t) => s + t.realizedR, 0) / trades.length;
  const avgWinR = wins.length ? wins.reduce((s, t) => s + t.realizedR, 0) / wins.length : 0;
  const avgLossR = losses.length ? losses.reduce((s, t) => s + t.realizedR, 0) / losses.length : 0;
  const maxDD = opts.dailyEquity ? maxDdPct(opts.dailyEquity) : 0;
  return {
    tradeCount: trades.length,
    winRate: wins.length / trades.length,
    profitFactor:
      grossLoss === 0 ? (grossWin === 0 ? 0 : Number.POSITIVE_INFINITY) : grossWin / grossLoss,
    expectancyR,
    avgWinR,
    avgLossR,
    maxDrawdownPct: maxDD,
    sharpe: opts.dailyEquity ? sharpeFromEquity(opts.dailyEquity, opts.riskFreeRatePerDay ?? 0) : 0,
  };
}

function sharpeFromEquity(eq: readonly EquityPoint[], rfPerDay: number): number {
  if (eq.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    const a = eq[i - 1] as EquityPoint;
    const b = eq[i] as EquityPoint;
    if (a.equity > 0) returns.push(b.equity / a.equity - 1 - rfPerDay);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

function maxDdPct(eq: readonly EquityPoint[]): number {
  let peak = 0;
  let max = 0;
  for (const p of eq) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak === 0 ? 0 : (peak - p.equity) / peak;
    if (dd > max) max = dd;
  }
  return max;
}
