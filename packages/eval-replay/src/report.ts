import type { Symbol } from "@forex-bot/contracts";
import type { ReplayReport, Trade } from "@forex-bot/eval-core";

const MAX_TRADE_ROWS = 50;

export function formatMarkdown(report: ReplayReport): string {
  const lines: string[] = [];
  lines.push("# Replay Report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Window start: ${isoOrEmpty(report.window.startMs)}`);
  lines.push(`- Window end: ${isoOrEmpty(report.window.endMs)}`);
  lines.push(`- Symbols: ${report.symbols.length === 0 ? "(none)" : report.symbols.join(", ")}`);
  lines.push(`- Generated at: ${isoOrEmpty(report.generatedAt)}`);
  lines.push("");

  lines.push("## Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Trade count | ${report.metrics.tradeCount} |`);
  lines.push(`| Win rate | ${formatPct(report.metrics.winRate)} |`);
  lines.push(`| Profit factor | ${formatNum(report.metrics.profitFactor)} |`);
  lines.push(`| Expectancy (R) | ${formatNum(report.metrics.expectancyR)} |`);
  lines.push(`| Avg win (R) | ${formatNum(report.metrics.avgWinR)} |`);
  lines.push(`| Avg loss (R) | ${formatNum(report.metrics.avgLossR)} |`);
  lines.push(`| Sharpe | ${formatNum(report.metrics.sharpe)} |`);
  lines.push(`| Max drawdown | ${formatPct(report.metrics.maxDrawdownPct)} |`);
  lines.push("");

  if (report.llmCacheStats) {
    const { hits, misses } = report.llmCacheStats;
    const total = hits + misses;
    const rate = total === 0 ? 0 : hits / total;
    lines.push(`Cache: ${hits} hits / ${misses} misses (hit rate ${formatPct(rate)})`);
    lines.push("");
  }

  lines.push("## Trades");
  lines.push("");
  if (report.trades.length === 0) {
    lines.push("No trades.");
    lines.push("");
  } else {
    const shown = report.trades.slice(0, MAX_TRADE_ROWS);
    lines.push("| ts | symbol | side | entry | exit | pnl | R | exitReason |");
    lines.push("|----|--------|------|-------|------|-----|---|------------|");
    for (const t of shown) {
      lines.push(
        `| ${new Date(t.closedAt).toISOString()} | ${t.symbol} | ${t.side} | ${formatPrice(
          t.entry,
        )} | ${formatPrice(t.exit)} | ${formatNum(t.pnl)} | ${formatNum(t.realizedR)} | ${
          t.exitReason
        } |`,
      );
    }
    if (report.trades.length > MAX_TRADE_ROWS) {
      lines.push("");
      lines.push(`(showing first ${MAX_TRADE_ROWS} of ${report.trades.length} trades)`);
    }
    lines.push("");
  }

  lines.push("## Per-symbol breakdown");
  lines.push("");
  if (report.trades.length === 0) {
    lines.push("No trades.");
    lines.push("");
  } else {
    lines.push("| Symbol | Count | Win rate | Expectancy (R) |");
    lines.push("|--------|-------|----------|----------------|");
    const grouped = groupBySymbol(report.trades);
    const symbolOrder = uniqueOrder(report.trades.map((t) => t.symbol));
    for (const sym of symbolOrder) {
      const trades = grouped.get(sym) ?? [];
      const wins = trades.filter((t) => t.pnl > 0).length;
      const winRate = trades.length === 0 ? 0 : wins / trades.length;
      const expectancyR =
        trades.length === 0 ? 0 : trades.reduce((s, t) => s + t.realizedR, 0) / trades.length;
      lines.push(
        `| ${sym} | ${trades.length} | ${formatPct(winRate)} | ${formatNum(expectancyR)} |`,
      );
    }
    lines.push("");
  }

  lines.push("<!-- per-session: TODO -->");
  lines.push("");
  return lines.join("\n");
}

export function formatJson(report: ReplayReport): string {
  const ordered = orderReport(report);
  return JSON.stringify(ordered, null, 2);
}

function orderReport(report: ReplayReport): Record<string, unknown> {
  return {
    generatedAt: report.generatedAt,
    window: report.window,
    symbols: report.symbols,
    metrics: report.metrics,
    llmCacheStats: report.llmCacheStats,
    trades: report.trades,
    equity: report.equity,
    journals: report.journals,
  };
}

function isoOrEmpty(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  return `${(v * 100).toFixed(1)}%`;
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  return v.toFixed(2);
}

function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // Prices vary in scale (1.0850 vs 150.50 vs 1950.0) — use 5 sig figs after decimal capped.
  return v.toFixed(5);
}

function groupBySymbol(trades: readonly Trade[]): Map<Symbol, Trade[]> {
  const out = new Map<Symbol, Trade[]>();
  for (const t of trades) {
    const arr = out.get(t.symbol) ?? [];
    arr.push(t);
    out.set(t.symbol, arr);
  }
  return out;
}

function uniqueOrder(values: readonly Symbol[]): Symbol[] {
  const seen = new Set<Symbol>();
  const out: Symbol[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
