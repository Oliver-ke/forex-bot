# Unified Runner Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `paper-runner` (staging) and `agent-runner` (prod) run **one shared operational harness**, differing only by an injected `Executor` (paper-simulate vs live-place) and config — so what you measure in staging is the exact code path prod runs.

**Architecture:** Extract the operational loop into a new `@forex-bot/runner` package: `poll → market-skip → triggers → tick → record decision → executor.open(approved) → executor.reconcile() → record closed trades → metrics`. The paper/live fork collapses to an `Executor` interface — `PaperExecutor` reuses eval-replay's stateless `simulateClose()` for real SL/TP fills; `LiveExecutor` reuses the existing `@forex-bot/executor` (`preFire`/`execute`). A real `GateContextBuilder` replaces the stubbed `buildGateContextDefault` (spread/session/pipValue were hardcoded). `paper-runner`/`agent-runner` become thin entrypoints that wire deps.

**Tech Stack:** TypeScript (ESM, `exactOptionalPropertyTypes`), pnpm workspaces, vitest, zod v3, biome. No new runtime deps (reuses `@forex-bot/{executor,eval-core,indicators,risk,broker-core,memory,data-core}`).

## Global Constraints

- Node ≥ 20.11; pnpm 9.12.0; `"type": "module"` — all intra-repo imports use `.js` extensions.
- `tsconfig.base.json` has `exactOptionalPropertyTypes: true` — never assign `undefined` to an optional property; use conditional spread `...(x ? { k: x } : {})`.
- Biome: run `pnpm exec biome check --fix <file>` before commit; import ordering is enforced.
- Zod schemas are **v3 API** (`import { z } from "zod"`). The `Symbol` domain type is strict `/^[A-Z]{6}$/` — broker suffixes are handled only in `MT5Broker` (do not leak suffixed symbols into the domain).
- CI bans `new AnthropicLlm` and `MetaApi(token=` in test files — use `FakeLlm` / monkeypatch.
- Every task ends green: `pnpm -r typecheck`, `pnpm lint`, and the task's tests pass. Commit per task.

---

## Regression-Prevention Strategy (read first)

This refactor touches the decision/trade-producing core. The risk is silently changing decisions or trade outcomes. Controls, applied at every step:

1. **Separate structural from behavioral changes.** Phases 1 (extract harness) and 4 (migrate agent-runner) are **behavior-preserving**: code is *moved*, not rewritten. Phases 2 (real gate context), 3 (real outcomes), 5 (durable metrics) are **intentional behavior changes**, each isolated behind its own tests.

2. **Parity gate (Phase 1 & 4).** The shared harness, wired with a `LegacyPaperExecutor` that reproduces today's `synthesizeTrade` stub, MUST keep `apps/paper-runner/test/integration.test.ts` green **unchanged**. If a parity test needs editing to pass, that's a regression — stop and investigate.

3. **Golden snapshot (Phase 0).** Before any change, add a deterministic full-tick test (`FakeLlm` consensus route, fixed bundle) capturing the exact `RiskDecision` + journaled records. Re-run after each phase; intentional changes update the golden with a documented diff in the commit message.

4. **Never touch the graph or gates' logic.** `packages/graph` nodes and `packages/risk/src/gates/*` are correct; only their *inputs* (the gate context) were stubbed. No edits to gate logic in this plan except reading existing behavior.

5. **agent-runner migrates last**, guarded by the existing `apps/agent-runner/test/integration.test.ts` (which already exercises `@forex-bot/executor`).

6. **Each task is independently revertable** (own commit). Phases ship in order; each leaves working software.

---

## File Structure

**New package `packages/runner/`:**
- `package.json`, `tsconfig.json` — workspace package `@forex-bot/runner`.
- `src/index.ts` — barrel.
- `src/types.ts` — `Executor`, `OpenIntent`, `ClosedTrade` re-export, `RunnerDeps`, `RunnerConfig`, `RunnerState`.
- `src/gate-context.ts` — `buildGateContext(input): GateContext` (real spread/session/pip/account).
- `src/session.ts` — `sessionForUtc(ms): GateContext["session"]`.
- `src/pip-value.ts` — `pipValuePerLot(symbol): number`.
- `src/run-iteration.ts` — the shared loop (extracted from paper-runner).
- `src/paper-executor.ts` — `PaperExecutor` (reuses `simulateClose`).
- `src/live-executor.ts` — `LiveExecutor` (reuses `@forex-bot/executor`).
- `test/*.test.ts` — per-unit tests.

**Moved/reused:**
- `packages/eval-replay/src/close-simulator.ts` → its `simulateClose`, `SimulatedPosition`, `SimulatedClose` are **moved** to `packages/eval-core/src/close-simulator.ts` (shared by eval-replay AND runner; eval-replay re-imports). Pure, no deps.

**Modified entrypoints (shrink to wiring):**
- `apps/paper-runner/src/main.ts` — wire `PaperExecutor` + demo broker + guards + real gate context.
- `apps/agent-runner/src/main.ts` — wire `LiveExecutor` + live broker.

---

## Phase 0 — Safety net

### Task 0.1: Golden full-tick snapshot test

**Files:**
- Test: `apps/paper-runner/test/golden-tick.test.ts` (Create)

**Interfaces:**
- Consumes: existing `runIteration`, `initialState`, `PaperRunnerDeps`, `InMemoryJournalStore`, `FakeBroker`, `FakeLlm` consensus route (copy the `consensusLongRoute` + `buildHarness` shape from `integration.test.ts`).
- Produces: a frozen baseline; later phases assert against it.

- [ ] **Step 1: Write the golden test** — drive one `runIteration` with a fixed `FakeLlm` consensus-long route and ≥15 fresh H1 bars; snapshot the journaled decision record (`symbol`, `verdict.direction`, `verdict.confidence`, `risk.approve`, and if approved `risk.sl`/`risk.tp` sign relative to entry).

```ts
// Mirror buildHarness() from integration.test.ts (InMemoryJournalStore, FakeBroker demo, FakeLlm).
it("golden: consensus-long tick produces a stable decision shape", async () => {
  const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
  const { deps, decisions } = await buildHarness({ startMs });
  const state = initialState(startMs - 60 * 60_000);
  await runIteration(deps, state, startMs);
  const items = (await decisions.list({ limit: 10 })).items;
  expect(items.length).toBe(1);
  const d = items[0];
  expect(d?.verdict.direction).toBe("long");
  expect(typeof d?.risk.approve).toBe("boolean");
  // Record the exact approve value + counters as the baseline.
  expect({ approve: d?.risk.approve, ticks: state.decisions.ticks }).toMatchSnapshot();
});
```

- [ ] **Step 2: Run to capture the snapshot**

Run: `pnpm exec vitest run apps/paper-runner/test/golden-tick.test.ts`
Expected: PASS, writes `__snapshots__`.

- [ ] **Step 3: Commit**

```bash
git add apps/paper-runner/test/golden-tick.test.ts apps/paper-runner/test/__snapshots__
git commit -m "test(paper-runner): golden full-tick snapshot (regression baseline)"
```

---

## Phase 1 — Extract the shared harness (behavior-preserving)

### Task 1.1: Scaffold `@forex-bot/runner` + move `close-simulator` to eval-core

**Files:**
- Create: `packages/runner/package.json`, `packages/runner/tsconfig.json`, `packages/runner/src/index.ts`
- Create: `packages/eval-core/src/close-simulator.ts` (move from eval-replay)
- Modify: `packages/eval-replay/src/close-simulator.ts` (re-export from eval-core), `packages/eval-core/src/index.ts` (export), `packages/eval-replay/package.json` (already deps eval-core — verify)

**Interfaces:**
- Produces: `simulateClose(position: SimulatedPosition, bars: readonly Candle[]): SimulatedClose`, `SimulatedPosition { side; entry; sl; tp; expiresAt? }`, `SimulatedClose { exit; reason; closedAt; barIndex }` — now from `@forex-bot/eval-core`.

- [ ] **Step 1:** `git mv packages/eval-replay/src/close-simulator.ts packages/eval-core/src/close-simulator.ts`; add `export * from "./close-simulator.js";` to `packages/eval-core/src/index.ts`.
- [ ] **Step 2:** Re-create `packages/eval-replay/src/close-simulator.ts` as `export { simulateClose, type SimulatedPosition, type SimulatedClose } from "@forex-bot/eval-core";` (keeps existing import paths working — zero churn in eval-replay).
- [ ] **Step 3:** Create `packages/runner/package.json`:

```json
{
  "name": "@forex-bot/runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json", "build": "tsc -p tsconfig.json --outDir dist" },
  "dependencies": {
    "@forex-bot/agent-runner": "workspace:*",
    "@forex-bot/broker-core": "workspace:*",
    "@forex-bot/contracts": "workspace:*",
    "@forex-bot/data-core": "workspace:*",
    "@forex-bot/eval-core": "workspace:*",
    "@forex-bot/executor": "workspace:*",
    "@forex-bot/indicators": "workspace:*",
    "@forex-bot/llm-provider": "workspace:*",
    "@forex-bot/risk": "workspace:*",
    "@forex-bot/telemetry": "workspace:*"
  }
}
```

Copy `packages/graph/tsconfig.json` to `packages/runner/tsconfig.json` (same compiler options).

- [ ] **Step 4:** `pnpm install`; run `pnpm exec vitest run packages/eval-replay` — Expected: PASS (re-export is transparent).
- [ ] **Step 5: Commit** `git add -A && git commit -m "refactor(eval-core): move simulateClose to eval-core; scaffold @forex-bot/runner"`

### Task 1.2: Define harness types (`Executor`, `ClosedTrade`, `RunnerDeps`)

**Files:**
- Create: `packages/runner/src/types.ts`

**Interfaces:**
- Produces (consumed by all later tasks):

```ts
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
  journal: JournalStore;     // approved trades (with outcome once closed)
  decisions: JournalStore;   // every decision
  buildGateContext: (input: {
    now: number;
    symbol: Symbol;
    account: GateContext["account"];
    bundle: StateBundle;
  }) => GateContext;
  log: { info: (m: string, f?: object) => void; warn: (m: string, f?: object) => void; error: (m: string, f?: object) => void };
  watchedSymbols: readonly Symbol[];
  consensusThreshold: number;
  marketStaleMs: number;
}
```

- [ ] **Step 1:** Write `packages/runner/src/types.ts` with the above; add `export * from "./types.js";` to `index.ts`.
- [ ] **Step 2:** Run `pnpm --filter @forex-bot/runner typecheck` — Expected: PASS.
- [ ] **Step 3: Commit** `git commit -am "feat(runner): harness types (Executor, ClosedTrade, RunnerDeps)"`

### Task 1.3: Extract `runIteration` into the harness (parity)

**Files:**
- Create: `packages/runner/src/run-iteration.ts`, `packages/runner/test/run-iteration.test.ts`
- Reference (do not delete yet): `apps/paper-runner/src/main.ts` `runIteration`

**Interfaces:**
- Consumes: `RunnerDeps`, `tick`/`detectTriggers`/`isMarketClosed`/`feedAgeMs` from `@forex-bot/agent-runner`.
- Produces: `runIteration(deps: RunnerDeps, state: RunnerState, nowMs: number): Promise<RunnerState>`, `initialState(nowMs): RunnerState`, `RunnerState { lastTickedMs; lastRebalanceMs; decisions: DecisionCounters }`.

- [ ] **Step 1: Write the parity test** — copy `buildHarness`/`consensusLongRoute` from `apps/paper-runner/test/integration.test.ts`, but build `RunnerDeps` (add `executor`, `buildGateContext` adapting the test's `buildGateContextForTest`). Assert: 3 ticks → `decisions.ticks === 3`; decisions store gets 3 records; with an approving executor, `executor.open` called on each approved tick. (Full test body mirrors integration.test.ts lines for the harness shape.)

- [ ] **Step 2: Run — expect FAIL** (`run-iteration` not implemented). `pnpm exec vitest run packages/runner/test/run-iteration.test.ts`.

- [ ] **Step 3: Implement `run-iteration.ts`** by **moving** the loop body from `apps/paper-runner/src/main.ts` (`runIteration`), replacing the `synthesizeTrade`/`cumulativeTrades` block with:

```ts
// On approved tick: record decision (always) + ask executor to open.
state.decisions.ticks += 1;
const approved = result.decision.approve;
if (approved) state.decisions.approved += 1; else state.decisions.vetoed += 1;
if (result.verdict) {
  const entry = { tradeId: `${symbol}-${nowMs}`, symbol, openedAt: nowMs,
    ...(result.analysts ? { analysts: [...result.analysts] } : {}),
    verdict: result.verdict, risk: result.decision } as TradeJournal;
  try {
    await deps.decisions.put(entry);
    if (approved) await deps.executor.open({ symbol, now: nowMs, decision: result.decision, bundle: result.bundle, pipValuePerLot: /* from gate ctx */ });
  } catch (e) { deps.log.error("decision/open failed", { tradeId: entry.tradeId, err: String(e) }); }
}
// After per-symbol loop: close-out pass.
const closed = await deps.executor.reconcile(nowMs);
for (const t of closed) { /* journal trade with outcome — Task 3.3 */ }
```

Keep the market-stale skip, trigger detection, and `buildGateContext` call **identical** to current behavior.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(runner): extract shared runIteration harness"`

### Task 1.4: Migrate `paper-runner` to the harness (parity gate)

**Files:**
- Modify: `apps/paper-runner/src/main.ts` (remove local `runIteration`/`synthesizeTrade`; import from `@forex-bot/runner`), `apps/paper-runner/package.json` (add `@forex-bot/runner`)
- Modify: `apps/paper-runner/test/integration.test.ts` (import `runIteration`/`initialState` from `@forex-bot/runner`; inject a `LegacyPaperExecutor` that reproduces the old stub so assertions stay identical)
- Create: `packages/runner/src/paper-executor.ts` interim `LegacyPaperExecutor` (pnl=0 stub) — **temporary**, replaced in Phase 3.

**Interfaces:**
- Consumes: `runIteration`, `RunnerDeps`.

- [ ] **Step 1:** Implement `LegacyPaperExecutor` whose `open()` records a `synthesizeTrade`-equivalent (pnl 0) into an in-memory list and journals it; `reconcile()` returns `[]`. This preserves "approved trade accumulates" behavior.
- [ ] **Step 2:** Rewire `apps/paper-runner/src/main.ts` to construct `RunnerDeps` (broker, cache, llm, `executor: new LegacyPaperExecutor(...)`, journal, decisions, real `buildGateContext` — interim: keep current stub values, fixed in Phase 2). Delete the duplicated loop.
- [ ] **Step 3:** Point `integration.test.ts` + `golden-tick.test.ts` imports at `@forex-bot/runner`. **Do not change assertions.**
- [ ] **Step 4: Run the FULL suite** `pnpm test` — Expected: PASS, **golden snapshot unchanged**. (Parity gate. If golden changed, revert and investigate.)
- [ ] **Step 5: Commit** `git commit -am "refactor(paper-runner): run on the shared harness (parity, no behavior change)"`

---

## Phase 2 — Real gate-context builder (fix the stubs)

> Behavioral change: replaces hardcoded `spread 1.0 / session "london" / pipValue $10`. Margin cap already uses the real account (`freeMargin × 0.8`) — no change. Order entry/sl/tp already fixed in `gatesNode`. The agent graph and gates are untouched.

### Task 2.1: `sessionForUtc` + `pipValuePerLot`

**Files:**
- Create: `packages/runner/src/session.ts`, `packages/runner/src/pip-value.ts`, `packages/runner/test/session.test.ts`, `packages/runner/test/pip-value.test.ts`

**Interfaces:**
- Produces: `sessionForUtc(ms: number): "asia" | "london" | "ny" | "overlap_ny_london" | "off"`; `pipValuePerLot(symbol: Symbol, quoteToUsd?: number): number`.

- [ ] **Step 1: Write session tests** — weekend (Sat/Sun before 21:00 UTC) → `"off"`; Mon 08:00 UTC → `"london"`; 13:00 UTC → `"overlap_ny_london"`; 18:00 UTC → `"ny"`; 02:00 UTC → `"asia"`.

```ts
const d = (y:number,mo:number,day:number,h:number)=>Date.UTC(y,mo,day,h);
expect(sessionForUtc(d(2026,5,20,2))).toBe("asia");     // Sat? pick a weekday
expect(sessionForUtc(d(2026,5,15,8))).toBe("london");   // Mon
expect(sessionForUtc(d(2026,5,15,13))).toBe("overlap_ny_london");
expect(sessionForUtc(d(2026,5,15,18))).toBe("ny");
expect(sessionForUtc(d(2026,5,16,12))).toBe("off");     // Sat
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `sessionForUtc` using UTC day-of-week + hour windows (Sydney/Tokyo 22–07 asia; London 07–16; NY 12–21; overlap 12–16; weekend Fri≥21 / Sat / Sun<21 → off). Implement `pipValuePerLot`: `symbol.endsWith("JPY") ? 1000 / (quoteToUsd ?? 150) : 10` (standard-lot pip value; JPY ≈ $6.6, others $10).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(runner): real session + per-symbol pip value"`

### Task 2.2: `buildGateContext` from live data

**Files:**
- Create: `packages/runner/src/gate-context.ts`, `packages/runner/test/gate-context.test.ts`

**Interfaces:**
- Produces: `buildGateContext(input): GateContext` matching the `RunnerDeps.buildGateContext` signature. Real values: `session = sessionForUtc(now)`; spread from a quote (`broker.getQuote` passed via bundle or computed in caller — use `currentSpreadPips` from latest bid/ask if available, else median default); `pipValuePerLot` from Task 2.1; `atrPips` from `atr(bundle.market.H1,14)`; `account` passed through; `currencyExposurePct`/`openPositions` from the real account/positions; `affectedCurrencies = s => [s.slice(0,3), s.slice(3)]` (unchanged — domain symbols are 6-char).

- [ ] **Step 1: Write tests** — weekend `now` → `ctx.session === "off"`; `ctx.pipValuePerLot("USDJPY")` ≈ 6–7; `ctx.atrPips > 0` for a bundle with ≥15 H1 bars; `ctx.account.equity` passed through.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `buildGateContext`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5:** Wire it into `apps/paper-runner/src/main.ts` (replace the stubbed `buildGateContextDefault`). **Update the golden snapshot** — expected diff: session/spread now real; document in commit. Re-run `pnpm test`.
- [ ] **Step 6: Commit** `git commit -am "feat(runner): build real gate context (session/spread/pip); retire stub"`

---

## Phase 3 — Executor seam + real paper outcomes

### Task 3.1: `PaperExecutor` (real fills via `simulateClose`)

**Files:**
- Create: `packages/runner/src/paper-executor.ts`, `packages/runner/test/paper-executor.test.ts`
- Modify: `packages/runner/src/run-iteration.ts` (journal closed trades from `reconcile`)

**Interfaces:**
- Consumes: `simulateClose`, `SimulatedPosition` (`@forex-bot/eval-core`); `Broker.getCandles`; `JournalStore`.
- Produces: `class PaperExecutor implements Executor`. `open()` stores an open paper position `{tradeId, symbol, side, entry, sl, tp, lotSize, openedAt, expiresAt, verdict, decision, pipValuePerLot}`. `reconcile(now)` fetches H1 candles `> openedAt` per open position, runs `simulateClose`; on `reason !== "none"` computes `pnl`/`realizedR` (use the exact formula from `replay-engine.buildTrade`: `pips = ((exit-entry)/pipScale)*dir; pnl = pips*lot*pipValue; realizedR = stopDist===0?0:((exit-entry)*dir)/stopDist`), removes it from the open set, and returns the `ClosedTrade`.

- [ ] **Step 1: Write tests** — open a buy at 1.08 (sl 1.079, tp 1.082); feed candles where a later bar's low ≤ 1.079 → `reconcile` returns 1 trade, `exitReason==="sl"`, `pnl < 0`, `realizedR ≈ -1`. A bar with high ≥ 1.082 first → `exitReason==="tp"`, `pnl>0`. No trigger → `reconcile` returns `[]` (still open).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `PaperExecutor`** (reuse the quoted fill/pnl logic).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(runner): PaperExecutor with real SL/TP outcomes"`

### Task 3.2: Journal closed trades with `outcome`; swap out LegacyPaperExecutor

**Files:**
- Modify: `packages/runner/src/run-iteration.ts` (closed-trade journaling), `apps/paper-runner/src/main.ts` (use `PaperExecutor` not `LegacyPaperExecutor`; delete legacy), `apps/paper-runner/test/integration.test.ts` (assert outcomes)

**Interfaces:**
- Consumes: `TradeJournalSchema.outcome` (`{ closedAt; pnl; realizedR; mae; mfe; exitReason }`). On close, `journal.put({ ...openEntry, outcome })`.

- [ ] **Step 1: Update integration test** — after ticks + a closing candle, assert the trade-journal entry for an approved+closed trade has `outcome.pnl` defined and `outcome.exitReason` in the enum. Update golden if approve outcome changes (documented).
- [ ] **Step 2: Run — FAIL** (LegacyPaperExecutor returns no outcomes).
- [ ] **Step 3: Implement** — swap `PaperExecutor` in; in `run-iteration` journal each `ClosedTrade` into `deps.journal` with `outcome` populated (mae/mfe: set to `|entry-exit|`-based bounds or 0 if not tracked — pick `mae = Math.max(0, dir*(entry-worst))`; for v1 use 0 and note it). Delete `LegacyPaperExecutor`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(paper-runner): journal real trade outcomes; remove legacy stub"`

---

## Phase 4 — LiveExecutor + migrate agent-runner (stage↔prod parity)

### Task 4.1: `LiveExecutor` (reuses `@forex-bot/executor`)

**Files:**
- Create: `packages/runner/src/live-executor.ts`, `packages/runner/test/live-executor.test.ts`

**Interfaces:**
- Consumes: `preFire`, `execute` (`@forex-bot/executor`); `Broker.{placeOrder,getOpenPositions,closePosition}`; `reconcile` (executor).
- Produces: `class LiveExecutor implements Executor`. `open()` builds `PreFireInput` from the gate context + account, runs `preFire`; if pass, `execute({ ..., decision, order }, broker)`. `reconcile(now)` reads `broker.getOpenPositions()`, detects positions that disappeared (filled/closed) vs the tracked expected set via executor `reconcile`, and emits `ClosedTrade` for closed ones (pnl from `closePosition`/position deltas).

- [ ] **Step 1: Write tests** with a stub `Broker` (records `placeOrder` calls; returns positions). Assert: `open()` on an approved decision calls `broker.placeOrder` with correct side/lot/sl/tp; a failing `preFire` (wide spread) → no `placeOrder`, `open` returns false.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `LiveExecutor`.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(runner): LiveExecutor over @forex-bot/executor"`

### Task 4.2: Migrate `agent-runner` onto the harness

**Files:**
- Modify: `apps/agent-runner/src/main.ts` (replace bespoke loop with `runIteration` + `LiveExecutor` + real gate context + journal/decisions), `apps/agent-runner/package.json` (add `@forex-bot/runner`, `@forex-bot/memory`, `@forex-bot/data-core`)
- Modify: `apps/agent-runner/test/integration.test.ts` (assert the harness path: a `placeOrder` happens on approve via the executor stub)

**Interfaces:**
- Consumes: everything from Phases 1–4.

- [ ] **Step 1: Write/extend integration test** — agent-runner wired with `LiveExecutor` + stub broker + `FakeLlm` approving route → one `runIteration` results in a `broker.placeOrder` call and a journaled decision.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — `agent-runner/main.ts` becomes: `readConfig` → broker (live), cache, llm, `executor: new LiveExecutor(broker, ...)`, journal/decisions (DynamoDB via env), `buildGateContext`, then `while(true){ await runIteration(deps,state,Date.now()); sleep(pollMs) }`. Delete the old loop.
- [ ] **Step 4: Run — PASS;** `pnpm -r typecheck && pnpm lint && pnpm test`.
- [ ] **Step 5: Commit** `git commit -am "refactor(agent-runner): run on the shared harness with LiveExecutor"`

### Task 4.3: Terraform — agent-runner env parity

**Files:**
- Modify: `infra/terraform/envs/prod/main.tf` (`module.agent_runner.env_vars`: add `JOURNAL_TABLE`, `DECISIONS_TABLE`, `BROKER_SYMBOL_SUFFIX`, `MARKET_STALE_SEC`; `extra_iam_policy_arns`: add journal/decisions rw)

- [ ] **Step 1:** Mirror the staging `paper_runner` env/IAM additions onto prod `agent_runner` (the prod data module already creates the tables). Run `terraform fmt` + `terraform validate` (prod).
- [ ] **Step 2: Commit** `git commit -am "infra(prod): wire agent-runner journal/decisions env + IAM"`

---

## Phase 5 — Durable metrics + accuracy

### Task 5.1: Durable metrics sink

**Files:**
- Create: `packages/memory/src/dynamo-metrics.ts` (`DynamoMetricsStore.put(snapshot)`), `packages/memory/test/dynamo-metrics.integration.test.ts`
- Modify: `infra/terraform/modules/data/main.tf` (+`<env>-metrics` table + rw policy + outputs), envs (env + IAM), `packages/runner/src/run-iteration.ts` (flush snapshot to the sink on UTC-day boundary instead of `/tmp` only)

- [ ] **Step 1–5:** Mirror the `DynamoJournalStore` pattern (Task already proven). Test with `dynamodb-local` (gated on `DYNAMO_TEST_ENDPOINT`, like existing integration tests). Persist the `DailyMetricsSnapshot`. Commit.

### Task 5.2: Accuracy scoring

**Files:**
- Create: `packages/eval-core/src/accuracy.ts` (`scoreAccuracy(trades): { directionalHitRate; winRate; expectancyR }`), test
- Modify: `run-iteration.ts` daily flush to include accuracy in the snapshot

- [ ] **Step 1–5:** Score each closed trade's `verdict.direction` vs realized P&L sign + win/loss; aggregate; include in the snapshot. Test with fixed trades. Commit.

---

## Self-Review

- **Spec coverage:** unify harness (P1) ✓; config/executor-only fork (P1.4/P4) ✓; real gate context / stub-fix (P2) ✓; real outcomes/metrics/accuracy = "measure in stage" (P3/P5) ✓; agent-runner execution (P4) ✓; stage↔prod parity (P4) ✓.
- **Regression controls:** golden snapshot (P0), parity gate (P1.4), structural-vs-behavioral separation, graph/gates untouched — all present.
- **Type consistency:** `Executor.open/reconcile`, `ClosedTrade=Trade`, `RunnerDeps`, `buildGateContext` signature used consistently across P1→P4.
- **Note:** This plan spans 5 subsystems; **each phase ships independently** and is the natural review boundary. Phases 1–2 deliver the unification + correct decisions; 3 makes staging measurable; 4 achieves stage↔prod parity + live execution; 5 adds durability/accuracy. Recommend executing/reviewing phase-by-phase, not all at once.
- **Open follow-ups (out of scope):** real `mae`/`mfe` tracking (P3.2 uses 0); spread source if broker quote lacks bid/ask history; risk-gate calibration so approvals actually occur (separate tuning thread).
