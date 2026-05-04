import type {
  AccountState,
  RiskDecision,
  StateBundle,
  Symbol as SymbolName,
  Verdict,
} from "@forex-bot/contracts";
import { defaultRiskConfig } from "@forex-bot/contracts";
import { type BuildGraphDeps, type GraphState, buildGraph } from "@forex-bot/graph";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import type { EventFixture } from "./event-fixture.js";

export interface EventRunDeps {
  llm: LlmProvider;
  /** Defaults to 0.6 — slightly looser than the production default to allow events through. */
  consensusThreshold?: number;
  /** Builds GateContext for the synthetic ts. Default uses a permissive prebuilt one. */
  buildGateContext?: (fixture: EventFixture) => GateContext;
  /**
   * Escape hatch for tests: dependency-inject the graph runner. The default
   * uses `buildGraph(...).invoke`, which exercises the real LangGraph wiring
   * end-to-end. Tests that just want to verify the runner's plumbing can pass
   * a fake invoker that returns a hand-crafted GraphState.
   */
  invokeGraph?: (input: {
    bundle: StateBundle;
    gateContext: GateContext;
  }) => Promise<GraphState>;
}

export interface EventRunResult {
  fixtureId: string;
  verdict?: Verdict;
  tentativeDecision?: RiskDecision;
  finalDecision?: RiskDecision;
  graphState: GraphState;
}

/** 30 pips offset for synthetic SL/TP — generic, ATR-ish placeholder. */
const PLACEHOLDER_PIPS = 30;

function pipScale(symbol: SymbolName): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

function defaultAccount(ts: number): AccountState {
  return {
    ts,
    currency: "USD",
    balance: 10_000,
    // equity must be > 0 per AccountStateSchema.
    equity: 10_000,
    freeMargin: 10_000,
    usedMargin: 0,
    marginLevelPct: 0,
  };
}

function defaultGateContext(fixture: EventFixture): GateContext {
  const lastM15 = fixture.bars.M15.at(-1);
  if (lastM15 === undefined) {
    // MTFBundleSchema enforces .min(1); defensive only.
    throw new Error(`fixture ${fixture.id} has no M15 bars`);
  }
  const direction = fixture.expected?.direction ?? "long";
  const side: "buy" | "sell" = direction === "short" ? "sell" : "buy";
  const offset = PLACEHOLDER_PIPS * pipScale(fixture.symbol);
  const entry = lastM15.close;
  const sl = side === "buy" ? entry - offset : entry + offset;
  const tp = side === "buy" ? entry + offset * 1.5 : entry - offset * 1.5;
  const now = fixture.decisionAt;
  return {
    now,
    order: {
      symbol: fixture.symbol,
      side,
      lotSize: 0.1,
      entry,
      sl,
      tp,
      expiresAt: now + 5 * 60_000,
    },
    account: defaultAccount(now),
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: PLACEHOLDER_PIPS,
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
}

function buildBundle(fixture: EventFixture): StateBundle {
  return {
    symbol: fixture.symbol,
    ts: fixture.decisionAt,
    trigger: { reason: "news_event", detail: fixture.name },
    market: fixture.bars,
    account: defaultAccount(fixture.decisionAt),
    openPositions: [],
    recentNews: fixture.recentNews,
    upcomingEvents: fixture.upcomingEvents,
    regimePrior: { label: "event-driven", volBucket: "high" },
  };
}

/**
 * Runs a single event fixture through the full agent graph and returns the
 * resulting verdict + risk decisions for downstream scoring.
 */
export async function runEvent(fixture: EventFixture, deps: EventRunDeps): Promise<EventRunResult> {
  const bundle = buildBundle(fixture);
  const gateContext = deps.buildGateContext?.(fixture) ?? defaultGateContext(fixture);

  const invoke =
    deps.invokeGraph ??
    (async (input: {
      bundle: StateBundle;
      gateContext: GateContext;
    }): Promise<GraphState> => {
      const graphDeps: BuildGraphDeps = {
        llm: deps.llm,
        consensusThreshold: deps.consensusThreshold ?? 0.6,
      };
      const graph = buildGraph(graphDeps);
      // LangGraph's invoke returns the merged state typed as the annotation
      // root; cast to GraphState since the annotations mirror it.
      return (await graph.invoke(input)) as GraphState;
    });

  const state = await invoke({ bundle, gateContext });
  // exactOptionalPropertyTypes: only set keys when present so we don't widen
  // them with `undefined`.
  const result: EventRunResult = { fixtureId: fixture.id, graphState: state };
  if (state.verdict !== undefined) result.verdict = state.verdict;
  if (state.tentativeDecision !== undefined) result.tentativeDecision = state.tentativeDecision;
  if (state.finalDecision !== undefined) result.finalDecision = state.finalDecision;
  return result;
}
