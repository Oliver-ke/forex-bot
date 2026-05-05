import type { EquityPoint, Trade } from "./types.js";

export interface BuildEquityCurveOpts {
  stepMs: number;
}

export function buildEquityCurve(
  startEquity: number,
  trades: readonly Trade[],
  opts: BuildEquityCurveOpts,
): EquityPoint[] {
  if (trades.length === 0) {
    return [{ ts: 0, equity: startEquity, drawdown: 0 }];
  }
  const { stepMs } = opts;
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const firstClosed = (sorted[0] as Trade).closedAt;
  const lastClosed = (sorted[sorted.length - 1] as Trade).closedAt;
  const startBucket = Math.floor(firstClosed / stepMs) * stepMs;
  const endBucket = Math.floor(lastClosed / stepMs) * stepMs;

  const out: EquityPoint[] = [];
  let peak = 0;
  for (let ts = startBucket; ts <= endBucket; ts += stepMs) {
    let cumPnl = 0;
    for (const t of sorted) {
      if (t.closedAt <= ts) cumPnl += t.pnl;
      else break;
    }
    const equity = startEquity + cumPnl;
    if (equity > peak) peak = equity;
    const drawdown = peak === 0 ? 0 : (peak - equity) / peak;
    out.push({ ts, equity, drawdown });
  }
  return out;
}
