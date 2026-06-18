import { type Symbol, defaultRiskConfig } from "@forex-bot/contracts";
import type { StateBundle } from "@forex-bot/contracts";
import { atr } from "@forex-bot/indicators";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { pipValuePerLot } from "./pip-value.js";
import { sessionForUtc } from "./session.js";

/** Default spread used when `StateBundle` carries no live bid/ask. */
const DEFAULT_SPREAD_PIPS = 1.0;

/** Fall-back ATR (in pips) when H1 has < 15 bars or ATR is undefined/≤0. */
const DEFAULT_ATR_PIPS = 20;

/**
 * Derives a `GateContext` from live runner inputs.
 *
 * - `session`       : from `sessionForUtc(input.now)`
 * - `pipValuePerLot`: wraps the `pipValuePerLot` helper (caller provides quoteToUsd via closure)
 * - `atrPips`       : ATR(14) from `bundle.market.H1`, converted by pip scale.
 *                     Falls back to `DEFAULT_ATR_PIPS` if H1 has < 15 bars or ATR is ≤ 0.
 * - `account`       : passed through unchanged.
 * - `currentSpreadPips` / `medianSpreadPips`: `StateBundle` carries no live quote/bid/ask —
 *                     both default to `DEFAULT_SPREAD_PIPS` (1.0 pip).
 * - `openPositions` : `bundle.openPositions ?? []`
 * - `currencyExposurePct`: `{}` (no exposure source available without a broker).
 * - `order`         : minimal placeholder — gatesNode overwrites entry/sl/tp/side/atrPips
 *                     from real H1 data when it runs.
 * - All other fields (`config`, `correlation`, `killSwitch`, counters, `feedAgeSec`,
 *   `upcomingEvents`, `affectedCurrencies`) are set to safe defaults.
 */
export function buildGateContext(input: {
  now: number;
  symbol: Symbol;
  account: GateContext["account"];
  bundle: StateBundle;
}): GateContext {
  const { now, symbol, account, bundle } = input;

  // --- atrPips ---
  const pipScale = symbol.endsWith("JPY") ? 0.01 : 0.0001;
  const h1Bars = bundle.market.H1;
  let atrPips = DEFAULT_ATR_PIPS;
  if (h1Bars.length >= 15) {
    const series = atr(h1Bars, 14);
    const lastAtr = series.at(-1);
    if (lastAtr !== undefined && lastAtr > 0) {
      atrPips = lastAtr / pipScale;
    }
  }

  // --- placeholder order (gatesNode overwrites per-trade fields) ---
  const lastClose = h1Bars.at(-1)?.close ?? 1.08;
  const placeholderEntry = lastClose;
  const placeholderSl = lastClose - 10 * pipScale; // 10-pip SL placeholder
  const placeholderTp = lastClose + 15 * pipScale; // 15-pip TP placeholder

  return {
    now,
    order: {
      symbol,
      side: "buy",
      lotSize: 0.1,
      entry: placeholderEntry,
      sl: placeholderSl,
      tp: placeholderTp,
      expiresAt: now + 5 * 60_000,
    },
    account,
    openPositions: bundle.openPositions ?? [],
    config: defaultRiskConfig,
    currentSpreadPips: DEFAULT_SPREAD_PIPS,
    medianSpreadPips: DEFAULT_SPREAD_PIPS,
    atrPips,
    session: sessionForUtc(now),
    upcomingEvents: [],
    correlation: new CorrelationMatrix({}),
    killSwitch: new KillSwitch(),
    consecutiveLosses: 0,
    dailyPnlPct: 0,
    totalDdPct: 0,
    feedAgeSec: 1,
    currencyExposurePct: {},
    affectedCurrencies: (s) => [s.slice(0, 3), s.slice(3)],
    pipValuePerLot: (sym) => pipValuePerLot(sym),
  };
}
