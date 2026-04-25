import type {
  AccountState,
  CalendarEvent,
  PendingOrder,
  Position,
  RiskConfig,
  Symbol,
} from "@forex-bot/contracts";
import type { CorrelationMatrix } from "../correlation.js";
import type { KillSwitch } from "../kill-switch.js";

export interface GateContext {
  now: number;
  order: PendingOrder;
  account: AccountState;
  openPositions: readonly Position[];
  config: RiskConfig;
  currentSpreadPips: number;
  medianSpreadPips: number;
  atrPips: number;
  session: "asia" | "london" | "ny" | "overlap_ny_london" | "off";
  upcomingEvents: readonly CalendarEvent[];
  correlation: CorrelationMatrix;
  killSwitch: KillSwitch;
  consecutiveLosses: number;
  dailyPnlPct: number;
  totalDdPct: number;
  feedAgeSec: number;
  currencyExposurePct: Record<string, number>;
  affectedCurrencies: (symbol: Symbol) => readonly string[];
  pipValuePerLot: (symbol: Symbol) => number;
}

export interface GateResult {
  pass: boolean;
  gate: string;
  reason?: string;
}

export type Gate = (ctx: GateContext) => GateResult;
