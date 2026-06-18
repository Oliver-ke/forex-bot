import type { Broker } from "@forex-bot/broker-core";
import type {
  AnalystOutput,
  RiskDecision,
  StateBundle,
  Symbol,
  Verdict,
} from "@forex-bot/contracts";
import type { HotCache, JournalStore } from "@forex-bot/data-core";
import type { Trade } from "@forex-bot/eval-core";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GateContext } from "@forex-bot/risk";

/** eval-core Trade extended with optional analyst outputs for journal parity. */
export interface ClosedTrade extends Trade {
  /** Per-analyst outputs from the tick graph — present on paper-executor trades. */
  analysts?: readonly AnalystOutput[];
}

/** When a tick approves, the harness asks the executor to open. */
export interface OpenIntent {
  symbol: Symbol;
  now: number;
  decision: Extract<RiskDecision, { approve: true }>;
  bundle: StateBundle;
  pipValuePerLot: number;
  /** Per-analyst outputs from the tick graph — carried through for journal parity. */
  analysts?: readonly AnalystOutput[];
  /** Full graph verdict — carried through so the trade journal matches the decisions stream. */
  verdict?: Verdict;
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
  /** Budget gate: paper-runner's BudgetTracker satisfies this structurally. */
  budget: { readonly tripped: boolean; readonly spendUsd: number };
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
