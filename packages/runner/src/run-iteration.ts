import { detectTriggers, feedAgeMs, isMarketClosed, tick } from "@forex-bot/agent-runner";
import type { TradeJournal } from "@forex-bot/contracts";
import type { RunnerDeps } from "./types.js";

export interface DecisionCounters {
  ticks: number;
  approved: number;
  vetoed: number;
  consensus: number;
  debated: number;
  judgeOverrideOfDebate: number;
  riskOfficerOverride: number;
}

export function emptyDecisionCounters(): DecisionCounters {
  return {
    ticks: 0,
    approved: 0,
    vetoed: 0,
    consensus: 0,
    debated: 0,
    judgeOverrideOfDebate: 0,
    riskOfficerOverride: 0,
  };
}

export interface RunnerState {
  lastTickedMs: number;
  lastRebalanceMs: number;
  decisions: DecisionCounters;
}

/** Build the initial state for the poll loop, anchored at `nowMs`. */
export function initialState(nowMs: number): RunnerState {
  return {
    lastTickedMs: nowMs,
    lastRebalanceMs: nowMs,
    decisions: emptyDecisionCounters(),
  };
}

/**
 * Runs one iteration of the runner harness poll loop. Mutates `state` in place
 * and returns it for convenient chaining. Does NOT sleep — caller controls pacing.
 */
export async function runIteration(
  deps: RunnerDeps,
  state: RunnerState,
  nowMs: number,
): Promise<RunnerState> {
  for (const symbol of deps.watchedSymbols) {
    try {
      const candlesH1 = await deps.broker.getCandles(symbol, "H1", 200);
      if (isMarketClosed(candlesH1, nowMs, deps.marketStaleMs)) {
        deps.log.info("market closed / feed stale — skipping tick", {
          symbol,
          feedAgeSec: Math.round(feedAgeMs(candlesH1, nowMs) / 1000),
        });
        continue;
      }
      const calendar = await deps.cache.getCalendarWindow();
      const triggers = detectTriggers({
        nowMs,
        lastTickedMs: state.lastTickedMs,
        candlesByTf: { H1: candlesH1 },
        upcomingEvents: calendar,
        lastRebalanceMs: state.lastRebalanceMs,
      });
      if (triggers.length === 0) continue;

      const account = await deps.broker.getAccount();
      const trigger = triggers[0];
      if (!trigger) continue;

      // Capture the gate context so we can reuse pipValuePerLot for OpenIntent.
      let capturedGateCtx: ReturnType<RunnerDeps["buildGateContext"]> | undefined;

      const result = await tick({
        broker: deps.broker,
        cache: deps.cache,
        llm: deps.llm,
        symbol,
        ts: nowMs,
        trigger,
        consensusThreshold: deps.consensusThreshold,
        buildGateContext: (bundle) => {
          const ctx = deps.buildGateContext({ now: nowMs, symbol, account, bundle });
          capturedGateCtx = ctx;
          return ctx;
        },
      });

      state.decisions.ticks += 1;
      const approved = result.decision.approve;
      if (approved) {
        state.decisions.approved += 1;
      } else {
        state.decisions.vetoed += 1;
      }

      if (result.verdict) {
        const entry: TradeJournal = {
          tradeId: `${symbol}-${nowMs}`,
          symbol,
          openedAt: nowMs,
          ...(result.analysts ? { analysts: [...result.analysts] } : {}),
          verdict: result.verdict,
          risk: result.decision,
        };
        try {
          await deps.decisions.put(entry);
          if (approved && result.decision.approve) {
            const pipValuePerLot = capturedGateCtx?.pipValuePerLot(symbol) ?? 10;
            await deps.executor.open({
              symbol,
              now: nowMs,
              decision: result.decision,
              bundle: result.bundle,
              pipValuePerLot,
            });
          }
        } catch (e) {
          deps.log.error("decision/open failed", {
            tradeId: entry.tradeId,
            err: String(e),
          });
        }
      } else {
        deps.log.warn("decision has no verdict; skipping record", { symbol });
      }

      deps.log.info("tick complete", {
        symbol,
        trigger: trigger.reason,
        approved: result.decision.approve,
      });
      if (triggers.some((t) => t.reason === "rebalance")) state.lastRebalanceMs = nowMs;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log.error("tick failed", { symbol, err: msg });
    }
  }
  state.lastTickedMs = nowMs;

  // Close-out pass: reconcile open positions and journal any that closed.
  const closed = await deps.executor.reconcile(nowMs);
  for (const t of closed) {
    const journalEntry: TradeJournal = {
      tradeId: `${t.symbol}-${t.openedAt}`,
      symbol: t.symbol,
      openedAt: t.openedAt,
      verdict: t.verdict,
      risk: t.decision,
      outcome: {
        closedAt: t.closedAt,
        pnl: t.pnl,
        realizedR: t.realizedR,
        mae: 0,
        mfe: 0,
        exitReason: t.exitReason,
      },
    };
    try {
      await deps.journal.put(journalEntry);
    } catch (e) {
      deps.log.error("journal write failed for closed trade", {
        tradeId: journalEntry.tradeId,
        err: String(e),
      });
    }
  }

  return state;
}
