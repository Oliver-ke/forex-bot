import { defaultRiskConfig } from "@forex-bot/contracts";
import { CorrelationMatrix } from "../../src/correlation.js";
import type { GateContext } from "../../src/gates/types.js";
import { KillSwitch } from "../../src/kill-switch.js";

export function mkGateCtx(overrides: Partial<GateContext> = {}): GateContext {
  const base: GateContext = {
    now: 1_700_000_000_000,
    order: {
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      entry: 1.08,
      sl: 1.075,
      tp: 1.09,
      expiresAt: 1_700_000_300_000,
    },
    account: {
      ts: 1_700_000_000_000,
      currency: "USD",
      balance: 10_000,
      equity: 10_000,
      freeMargin: 9_500,
      usedMargin: 500,
      marginLevelPct: 2000,
    },
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: 40,
    session: "london",
    upcomingEvents: [],
    correlation: new CorrelationMatrix({}),
    killSwitch: new KillSwitch(),
    consecutiveLosses: 0,
    dailyPnlPct: 0,
    totalDdPct: 0,
    feedAgeSec: 1,
    currencyExposurePct: {},
    affectedCurrencies: (s) => [s.slice(0, 3), s.slice(3)],
    pipValuePerLot: () => 10,
  };
  return { ...base, ...overrides };
}
