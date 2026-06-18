import type { Broker } from "@forex-bot/broker-core";
import type { RiskDecision, StateBundle, Symbol } from "@forex-bot/contracts";
import type { HotCache, JournalStore } from "@forex-bot/data-core";
import type { Trade } from "@forex-bot/eval-core";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GateContext } from "@forex-bot/risk";

export type ClosedTrade = Trade; // eval-core Trade: real pnl/realizedR/exitReason/verdict/decision

/** When a tick approves, the harness asks the executor to open. */
export interface OpenIntent {
  symbol: Symbol;
  now: number;
  decision: Extract<RiskDecision, { approve: true }>;
  bundle: StateBundle;
  pipValuePerLot: number;
}

export interface Executor {
  /** Open a position (paper: record; live: preFire+broker.placeOrder). Returns false if not opened. */
  open(intent: OpenIntent): Promise<boolean>;
  /** Advance/close open positions for `now`; return any that closed this call (with real outcomes). */
  reconcile(now: number): Promise<readonly ClosedTrade[]>;
}

export interface RunnerDeps {
  broker: Broker;
  cache: HotCache;
  llm: LlmProvider;
  executor: Executor;
  journal: JournalStore; // approved trades (with outcome once closed)
  decisions: JournalStore; // every decision
  buildGateContext: (input: {
    now: number;
    symbol: Symbol;
    account: GateContext["account"];
    bundle: StateBundle;
  }) => GateContext;
  log: {
    info: (m: string, f?: object) => void;
    warn: (m: string, f?: object) => void;
    error: (m: string, f?: object) => void;
  };
  watchedSymbols: readonly Symbol[];
  consensusThreshold: number;
  marketStaleMs: number;
}
