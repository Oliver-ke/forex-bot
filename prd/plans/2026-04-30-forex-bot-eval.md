# Forex Bot — Plan 5: Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the tiered eval harness from design §10. Build `packages/eval-core` (metrics, equity curve, trade-list types, fixture loaders), `packages/eval-replay` (historical bar replay + LLM cache), `packages/eval-event-study` (curated event fixtures + per-event scoring), and `apps/{eval-replay,eval-event-study,paper-runner}` apps. Cheap-mode replay uses a deterministic on-disk LLM cache; full-mode uses real Anthropic with budget caps. No real LLM calls in unit tests.

**Architecture:**
- `packages/eval-core` — pure TS. `Metrics` (Sharpe, profit factor, expectancy, R distribution, win rate, max DD), `EquityCurve`, `Trade` types, fixture loaders for CSV bars + JSON headlines/calendar, deterministic seedable PRNG, `ReplayClock`.
- `packages/eval-replay` — drives `tick()` from `@forex-bot/agent-runner` against fixture data using a `FixtureBroker` (replays bars/quotes from disk) and a `FixtureHotCache` (replays headlines/calendar). Wraps `LlmProvider` with `CachedLlm` (records to disk on miss, replays on hit). Closes positions when SL/TP hit using bar OHLC.
- `packages/eval-event-study` — packages curated event windows (NFP, FOMC, SNB unpeg, BoJ pivots, flash crashes). Each event = JSON fixture with snapshot of bars, news, calendar at T-N..T+M; runner drives `tick()` at T and scores the decision against realized move at T+horizon.
- `apps/eval-replay` — CLI: takes a replay window + cheap/full mode + symbols, runs the replay engine, writes a markdown + JSON report (P&L, DD, trade list, R distribution, per-regime/per-session breakdown).
- `apps/eval-event-study` — CLI: runs one event or full library. Outputs decision-quality table + per-event judgments.
- `apps/paper-runner` — daemon: same wiring as `agent-runner` but with paper guardrails (forced demo broker, budget cap, daily metrics flush, kill-switch on budget overrun). Writes daily metric snapshots to disk (CW/SNS lands in Plan 6).

**Tech Stack:** existing TS toolchain. New deps: `csv-parse@^5.5` (bar fixture loader), `dayjs@^1.11` (timezone math for sessions). No new test framework.

**Hard constraints:**
- Unit tests never make real LLM calls. CI grep from Plan 4 still applies.
- Replay must be deterministic in cheap mode: same fixture + same cache snapshot → bit-identical decision stream.
- Paper-runner cannot place real orders against a non-demo MT5 account: `main.ts` fails fast unless a `PAPER_MODE=1` flag is set and the broker self-reports as demo.

---

## File structure produced by this plan

```
forex-bot/
├── packages/
│   ├── eval-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── metrics.ts
│   │   │   ├── equity-curve.ts
│   │   │   ├── prng.ts
│   │   │   ├── clock.ts
│   │   │   ├── fixture-bars.ts
│   │   │   ├── fixture-headlines.ts
│   │   │   ├── fixture-calendar.ts
│   │   │   └── index.ts
│   │   └── test/
│   ├── eval-replay/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── llm-cache.ts
│   │   │   ├── cached-llm.ts
│   │   │   ├── fixture-broker.ts
│   │   │   ├── fixture-cache.ts
│   │   │   ├── close-simulator.ts
│   │   │   ├── replay-engine.ts
│   │   │   ├── report.ts
│   │   │   └── index.ts
│   │   └── test/
│   └── eval-event-study/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── event-fixture.ts
│       │   ├── runner.ts
│       │   ├── scoring.ts
│       │   ├── library/
│       │   │   ├── 2024-q4-nfp.json
│       │   │   ├── 2024-q4-fomc.json
│       │   │   └── 2015-snb-unpeg.json
│       │   └── index.ts
│       └── test/
└── apps/
    ├── eval-replay/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/{cli.ts,index.ts}
    │   └── test/
    ├── eval-event-study/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/{cli.ts,index.ts}
    │   └── test/
    └── paper-runner/
        ├── package.json
        ├── tsconfig.json
        ├── src/{guards.ts,metrics-writer.ts,main.ts,index.ts}
        └── test/
```

---

## Task 1: `eval-core` — package scaffold + types

**Files:**
- Create: `packages/eval-core/{package.json,tsconfig.json,src/{types.ts,index.ts}}`

- [ ] **Step 1: Write `packages/eval-core/package.json`**

```json
{
  "name": "@forex-bot/eval-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.json --outDir dist"
  },
  "dependencies": {
    "@forex-bot/contracts": "workspace:*",
    "csv-parse": "^5.5.0"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template).

- [ ] **Step 3: Write `packages/eval-core/src/types.ts`**

```ts
import type { RiskDecision, Symbol, TradeJournal, TradeOutcome, Verdict } from "@forex-bot/contracts";

export interface Trade {
  symbol: Symbol;
  openedAt: number;
  closedAt: number;
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
  exit: number;
  lotSize: number;
  pnl: number;
  realizedR: number;
  exitReason: TradeOutcome["exitReason"];
  verdict: Verdict;
  decision: RiskDecision;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  drawdown: number;
}

export interface ReplayReport {
  generatedAt: number;
  window: { startMs: number; endMs: number };
  symbols: readonly Symbol[];
  trades: readonly Trade[];
  equity: readonly EquityPoint[];
  metrics: import("./metrics.js").Metrics;
  llmCacheStats?: { hits: number; misses: number };
  journals: readonly TradeJournal[];
}
```

- [ ] **Step 4: Stub index**

```ts
export * from "./types.js";
```

- [ ] **Step 5: Install + typecheck**

Run: `pnpm install && pnpm --filter @forex-bot/eval-core typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/eval-core pnpm-lock.yaml
git commit -m "feat(eval-core): scaffold package + replay report types"
```

---

## Task 2: `eval-core` — metrics

**Files:**
- Create: `packages/eval-core/src/metrics.ts`, `packages/eval-core/test/metrics.test.ts`
- Modify: `packages/eval-core/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/eval-core/test/metrics.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../src/metrics.js";
import type { Trade } from "../src/types.js";

function trade(pnl: number, R: number, exitReason: Trade["exitReason"] = "tp"): Trade {
  return {
    symbol: "EURUSD",
    openedAt: 0,
    closedAt: 1,
    side: "buy",
    entry: 1,
    sl: 0.99,
    tp: 1.02,
    exit: 1.01,
    lotSize: 0.1,
    pnl,
    realizedR: R,
    exitReason,
    verdict: { direction: "long", confidence: 0.5, horizon: "H1", reasoning: "x" },
    decision: { approve: true, lotSize: 0.1, sl: 0.99, tp: 1.02, expiresAt: 0, reasons: ["ok"] },
  };
}

describe("computeMetrics", () => {
  it("computes profit factor, win rate, expectancy on a known set", () => {
    const m = computeMetrics([trade(10, 1), trade(-5, -1), trade(15, 1.5), trade(-5, -1)]);
    expect(m.winRate).toBeCloseTo(0.5, 5);
    expect(m.profitFactor).toBeCloseTo(25 / 10, 5);
    expect(m.expectancyR).toBeCloseTo((1 + -1 + 1.5 + -1) / 4, 5);
    expect(m.tradeCount).toBe(4);
  });

  it("returns NaN-safe values when there are no trades", () => {
    const m = computeMetrics([]);
    expect(m.tradeCount).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
  });

  it("computes Sharpe from equity returns when daily series is supplied", () => {
    const m = computeMetrics([], {
      dailyEquity: [
        { ts: 0, equity: 10_000, drawdown: 0 },
        { ts: 86_400_000, equity: 10_100, drawdown: 0 },
        { ts: 2 * 86_400_000, equity: 10_050, drawdown: 0.005 },
        { ts: 3 * 86_400_000, equity: 10_200, drawdown: 0 },
      ],
    });
    expect(m.sharpe).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write `packages/eval-core/src/metrics.ts`**

```ts
import type { EquityPoint, Trade } from "./types.js";

export interface Metrics {
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  maxDrawdownPct: number;
  sharpe: number;
}

export interface ComputeMetricsOpts {
  dailyEquity?: readonly EquityPoint[];
  riskFreeRatePerDay?: number;
}

export function computeMetrics(trades: readonly Trade[], opts: ComputeMetricsOpts = {}): Metrics {
  if (trades.length === 0) {
    return {
      tradeCount: 0,
      winRate: 0,
      profitFactor: 0,
      expectancyR: 0,
      avgWinR: 0,
      avgLossR: 0,
      maxDrawdownPct: 0,
      sharpe: opts.dailyEquity ? sharpeFromEquity(opts.dailyEquity, opts.riskFreeRatePerDay ?? 0) : 0,
    };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const expectancyR = trades.reduce((s, t) => s + t.realizedR, 0) / trades.length;
  const avgWinR = wins.length ? wins.reduce((s, t) => s + t.realizedR, 0) / wins.length : 0;
  const avgLossR = losses.length ? losses.reduce((s, t) => s + t.realizedR, 0) / losses.length : 0;
  const maxDD = opts.dailyEquity ? maxDdPct(opts.dailyEquity) : 0;
  return {
    tradeCount: trades.length,
    winRate: wins.length / trades.length,
    profitFactor: grossLoss === 0 ? (grossWin === 0 ? 0 : Number.POSITIVE_INFINITY) : grossWin / grossLoss,
    expectancyR,
    avgWinR,
    avgLossR,
    maxDrawdownPct: maxDD,
    sharpe: opts.dailyEquity ? sharpeFromEquity(opts.dailyEquity, opts.riskFreeRatePerDay ?? 0) : 0,
  };
}

function sharpeFromEquity(eq: readonly EquityPoint[], rfPerDay: number): number {
  if (eq.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    const a = eq[i - 1] as EquityPoint;
    const b = eq[i] as EquityPoint;
    if (a.equity > 0) returns.push(b.equity / a.equity - 1 - rfPerDay);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

function maxDdPct(eq: readonly EquityPoint[]): number {
  let peak = 0;
  let max = 0;
  for (const p of eq) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak === 0 ? 0 : (peak - p.equity) / peak;
    if (dd > max) max = dd;
  }
  return max;
}
```

- [ ] **Step 3: Update index, run tests, commit**

```bash
git add packages/eval-core
git commit -m "feat(eval-core): add Metrics computation (PF, win rate, expectancy, Sharpe, DD)"
```

---

## Task 3: `eval-core` — equity curve builder

**Files:**
- Create: `packages/eval-core/src/equity-curve.ts`, `packages/eval-core/test/equity-curve.test.ts`

- [ ] **Step 1: Failing test** — given a starting equity, list of trades, and a daily resampling step, returns a daily `EquityPoint[]` with running drawdown.

- [ ] **Step 2: Write `equity-curve.ts`** — pure function `buildEquityCurve(start, trades, { stepMs }): EquityPoint[]`. Cumulates `pnl` at each `closedAt`, samples to daily buckets, computes running peak + drawdown.

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-core
git commit -m "feat(eval-core): add equity curve builder with running drawdown"
```

---

## Task 4: `eval-core` — PRNG + clock

**Files:**
- Create: `packages/eval-core/src/{prng.ts,clock.ts}`, `packages/eval-core/test/{prng.test.ts,clock.test.ts}`

- [ ] **Step 1: PRNG test + impl** — Mulberry32 32-bit seedable PRNG. `next(): number` (in [0,1)). Test: same seed → same first 5 outputs.

- [ ] **Step 2: Clock test + impl** — `ReplayClock`: `now()` returns the simulated ms; `advanceTo(ms)`; `step(deltaMs)`. Used to drive `Date.now`-style consumers without monkey-patching the global.

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-core
git commit -m "feat(eval-core): add seedable PRNG + ReplayClock"
```

---

## Task 5: `eval-core` — fixture loaders (bars / headlines / calendar)

**Files:**
- Create: `packages/eval-core/src/{fixture-bars.ts,fixture-headlines.ts,fixture-calendar.ts}`, `packages/eval-core/test/fixture-loaders.test.ts`, plus tiny golden CSV/JSON fixtures under `packages/eval-core/test/fixtures/`.

- [ ] **Step 1: Bars** — `loadBars(path, symbol): Promise<readonly Candle[]>`. Reads CSV with header `ts,open,high,low,close,volume`. Validates monotonic `ts`. Uses `csv-parse`.
- [ ] **Step 2: Headlines** — `loadHeadlines(path): Promise<readonly NewsHeadline[]>`. Reads JSON (array). Validates against `NewsHeadlineSchema`.
- [ ] **Step 3: Calendar** — `loadCalendar(path): Promise<readonly CalendarEvent[]>`. Reads JSON. Validates against `CalendarEventSchema`.
- [ ] **Step 4: Tests** — happy path + malformed-file rejection per loader. Use `import.meta.url` to resolve fixture paths.
- [ ] **Step 5: Run + commit**

```bash
git add packages/eval-core
git commit -m "feat(eval-core): add CSV/JSON fixture loaders for bars/headlines/calendar"
```

---

## Task 6: `eval-replay` — package scaffold

**Files:**
- Create: `packages/eval-replay/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@forex-bot/eval-replay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.json --outDir dist"
  },
  "dependencies": {
    "@forex-bot/agent-runner": "workspace:*",
    "@forex-bot/agents": "workspace:*",
    "@forex-bot/broker-core": "workspace:*",
    "@forex-bot/contracts": "workspace:*",
    "@forex-bot/data-core": "workspace:*",
    "@forex-bot/eval-core": "workspace:*",
    "@forex-bot/graph": "workspace:*",
    "@forex-bot/llm-provider": "workspace:*",
    "@forex-bot/risk": "workspace:*"
  }
}
```

- [ ] **Step 2: Tsconfig + stub index. Install + typecheck. Commit.**

```bash
git add packages/eval-replay pnpm-lock.yaml
git commit -m "feat(eval-replay): scaffold package"
```

---

## Task 7: `eval-replay` — `LlmCache` (file-backed)

**Files:**
- Create: `packages/eval-replay/src/llm-cache.ts`, `packages/eval-replay/test/llm-cache.test.ts`

The cache hashes `(model, system, user, schema-shape)` to a key, stores the validated response under `<dir>/<key>.json`. Stable across runs.

- [ ] **Step 1: Failing test** — covers (a) write-then-read round-trip, (b) miss returns `undefined`, (c) different `user` text → different keys, (d) corrupted JSON file → throws with file path in message.

- [ ] **Step 2: Implement** — `class LlmCache { get(key); set(key, value); makeKey(req): string }`. Uses `crypto.createHash("sha256")`. Schema shape included as `JSON.stringify(req.schema._def)` to invalidate on shape changes.

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add file-backed LLM response cache"
```

---

## Task 8: `eval-replay` — `CachedLlm`

**Files:**
- Create: `packages/eval-replay/src/cached-llm.ts`, `packages/eval-replay/test/cached-llm.test.ts`

Wraps another `LlmProvider`. Modes: `"replay-only"` (miss → throw), `"record"` (miss → call upstream, write to cache). Default cheap-mode is `"replay-only"`.

- [ ] **Step 1: Failing test** — uses `FakeLlm` as upstream; verifies hit avoids upstream call; verifies miss in `"replay-only"` throws; verifies `"record"` writes cache.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add CachedLlm wrapper (replay-only / record modes)"
```

---

## Task 9: `eval-replay` — `FixtureBroker`

**Files:**
- Create: `packages/eval-replay/src/fixture-broker.ts`, `packages/eval-replay/test/fixture-broker.test.ts`

Implements `Broker` over fixture data + a `ReplayClock`. `getCandles` returns the slice up to `clock.now()`. `placeOrder` opens an in-memory position using the close of the bar at `clock.now()`. Supports a configurable spread.

- [ ] **Step 1: Failing test** — `getCandles` slices correctly as the clock advances; `placeOrder` tracks a position; `closePosition` realizes pnl using simple bid/ask.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add FixtureBroker (clock-driven, fills from fixture bars)"
```

---

## Task 10: `eval-replay` — `FixtureHotCache`

**Files:**
- Create: `packages/eval-replay/src/fixture-cache.ts`, `packages/eval-replay/test/fixture-cache.test.ts`

`HotCache` impl that returns headlines/calendar filtered to `clock.now()`.

- [ ] **Step 1: Failing test** — given a clock at T, `recentHeadlines({sinceMs: T-3600s})` returns only headlines with ts in window AND ≤ T.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add FixtureHotCache (clock-respecting headlines/calendar)"
```

---

## Task 11: `eval-replay` — `closeSimulator`

**Files:**
- Create: `packages/eval-replay/src/close-simulator.ts`, `packages/eval-replay/test/close-simulator.test.ts`

Pure fn: given an open position + a sequence of subsequent OHLC bars, returns the close price + reason (`tp`, `sl`, `expiry`, `none`). For ambiguous bars where both SL and TP could be hit in the same bar, the worst-case (SL) is used — design choice, mirrors the conservative pessimism in `risk`.

- [ ] **Step 1: Failing tests** — TP-only hit, SL-only hit, both-hit (returns SL), neither (returns `none`), expiry (returns last close).

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add deterministic close simulator (SL/TP/expiry)"
```

---

## Task 12: `eval-replay` — `replay-engine`

**Files:**
- Create: `packages/eval-replay/src/replay-engine.ts`, `packages/eval-replay/test/replay-engine.test.ts`

The engine drives `tick()` from `@forex-bot/agent-runner`:
1. For each step in `[startMs..endMs]` of size `stepMs`, advance clock.
2. Call `detectTriggers` against fixture state.
3. If any trigger fires, call `tick({ broker, cache, llm, ... })` (using `CachedLlm`).
4. If `decision.approve === true`, open a synthetic position and pass to `closeSimulator` over future bars.
5. Append realized `Trade` to the report.
6. Return a `ReplayReport` with trades, equity curve, metrics, cache stats.

- [ ] **Step 1: Failing test** — small fixture (10 bars, 1 headline, 1 calendar event), pre-warmed cache for 3 LLM calls (analyst routes), a synthetic SL fill on bar 7. Engine returns 1 trade with the expected pnl/R.

- [ ] **Step 2: Implement** (~150 LoC).

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add replay engine (drives tick + simulates closes)"
```

---

## Task 13: `eval-replay` — `report.ts`

**Files:**
- Create: `packages/eval-replay/src/report.ts`, `packages/eval-replay/test/report.test.ts`

Pure formatter. Two outputs:
- `formatMarkdown(report): string` — header (window, symbols), summary table (PF, win rate, Sharpe, DD), trade table (limited to top 50), per-regime / per-session breakdown.
- `formatJson(report): string` — `JSON.stringify(report, null, 2)` with stable key order.

- [ ] **Step 1: Failing test** — markdown contains the metric values; JSON parses back to `ReplayReport` shape.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-replay
git commit -m "feat(eval-replay): add markdown + json report formatters"
```

---

## Task 14: `apps/eval-replay` — CLI

**Files:**
- Create: `apps/eval-replay/{package.json,tsconfig.json,src/{cli.ts,index.ts},test/cli.test.ts}`

CLI args:
- `--symbols EURUSD,USDJPY`
- `--start 2024-10-01T00:00Z --end 2024-12-31T00:00Z`
- `--bars-dir ./fixtures/bars/`
- `--headlines ./fixtures/headlines.json`
- `--calendar ./fixtures/calendar.json`
- `--mode cheap|full` (default `cheap`)
- `--cache-dir ./.eval-cache/`
- `--out ./reports/<ts>/` (writes `report.md` + `report.json`)
- `--budget-usd N` (only used in `full`; aborts if exceeded)

Implementation: parse args, build deps, call `replayEngine.run(...)`, write reports.

- [ ] **Step 1: Failing test** — runs CLI in-process against the same small fixture from Task 12, asserts the output files exist and contain the expected trade count.

- [ ] **Step 2: Implement** using `node:util parseArgs`.

- [ ] **Step 3: Run + commit**

```bash
git add apps/eval-replay pnpm-lock.yaml
git commit -m "feat(eval-replay-cli): add command-line replay runner"
```

---

## Task 15: `eval-event-study` — package scaffold + fixture format

**Files:**
- Create: `packages/eval-event-study/{package.json,tsconfig.json,src/{event-fixture.ts,index.ts}}`

Define the JSON schema for a curated event:

```ts
export const EventFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbol: SymbolSchema,
  decisionAt: z.number().int().nonnegative(),
  scoringHorizonMin: z.number().int().positive(),
  bars: MTFBundleSchema,
  recentNews: z.array(NewsHeadlineSchema),
  upcomingEvents: z.array(CalendarEventSchema),
  realized: z.object({
    /** Mid price `scoringHorizonMin` after `decisionAt`. */
    midAtT_plus: z.number(),
    /** Realized intraday range over the horizon. */
    rangePips: z.number(),
  }),
  expected: z
    .object({
      direction: z.enum(["long", "short", "neutral"]).optional(),
      /** Tolerance: |verdict.confidence - expected.confidence| ≤ tol counts as a pass. */
      tolerance: z.number().optional(),
    })
    .optional(),
});
```

- [ ] **Step 1: Write package.json + tsconfig + schema in `event-fixture.ts`. Stub index.**
- [ ] **Step 2: Install + typecheck. Commit.**

```bash
git add packages/eval-event-study pnpm-lock.yaml
git commit -m "feat(eval-event-study): scaffold + fixture schema"
```

---

## Task 16: `eval-event-study` — three canonical fixtures

**Files:**
- Create: `packages/eval-event-study/src/library/{2024-q4-nfp.json,2024-q4-fomc.json,2015-snb-unpeg.json}`
- Create: `packages/eval-event-study/test/library.test.ts`

Each fixture: 80–120 bars across M15/H1/H4/D1, 5–10 headlines, the relevant calendar event, realized outcome.

- [ ] **Step 1: Build the three JSON fixtures by hand (or via a helper script under `scripts/build-event-fixtures.ts`).**
- [ ] **Step 2: Failing test** — each fixture parses against `EventFixtureSchema`. Realized direction sanity check (e.g. SNB unpeg: realized range ≥ 1500 pips).
- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-event-study
git commit -m "feat(eval-event-study): add NFP / FOMC / SNB-unpeg curated fixtures"
```

---

## Task 17: `eval-event-study` — runner + scoring

**Files:**
- Create: `packages/eval-event-study/src/{runner.ts,scoring.ts}`, `packages/eval-event-study/test/{runner.test.ts,scoring.test.ts}`

`runner.run(fixture, deps): Promise<EventResult>`:
1. Build a `StateBundle` directly from fixture.
2. Build a `gateContext` (configurable factory; default uses fixture's `recentNews` + a permissive default).
3. Run `buildGraph(deps).invoke(...)`.
4. Score: pass if `verdict.direction` matches realized move sign at `decisionAt + scoringHorizonMin`, and the decision didn't blow up gates.

`scoreDecision(verdict, decision, fixture): EventScore` — pure function; returns `{ pass: boolean, reasons: string[] }`.

- [ ] **Step 1: Failing tests** — scoring unit tests (4–5 cases) + a runner integration test that uses `FakeLlm` scripted for each library fixture.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run + commit**

```bash
git add packages/eval-event-study
git commit -m "feat(eval-event-study): add runner + decision-quality scoring"
```

---

## Task 18: `apps/eval-event-study` — CLI

**Files:**
- Create: `apps/eval-event-study/{package.json,tsconfig.json,src/{cli.ts,index.ts},test/cli.test.ts}`

CLI args:
- `--id <fixtureId>` (single) OR `--all`
- `--mode cheap|full`
- `--cache-dir`
- `--out`

Output: per-event row + aggregate `passed/total`. Non-zero exit on any fail.

- [ ] **Step 1: Failing test** — runs CLI against the 3 fixtures with a scripted `FakeLlm`; asserts overall pass.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run + commit**

```bash
git add apps/eval-event-study pnpm-lock.yaml
git commit -m "feat(eval-event-study-cli): add CLI to run event-study fixtures"
```

---

## Task 19: `apps/paper-runner` — guards + scaffold

**Files:**
- Create: `apps/paper-runner/{package.json,tsconfig.json,src/{guards.ts,index.ts},test/guards.test.ts}`

Paper guards:
- `assertDemoBroker(broker)`: throws unless the broker advertises a demo flag.
- `BudgetTracker`: tracks LLM cost (received via `onUsage` callback in `LlmProvider`); flips a `tripped` flag when monthly cap is hit; tracker exposes a callback for `agent-runner` to fast-veto further ticks.
- `PositionCap`: ensures aggregate notional across open positions never exceeds a configured ceiling.

- [ ] **Step 1: Failing tests** for each guard.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run + commit**

```bash
git add apps/paper-runner pnpm-lock.yaml
git commit -m "feat(paper-runner): scaffold + paper guards (demo / budget / position cap)"
```

> Note: `Broker` interface needs a small extension (`isDemo: boolean`). Capture this as a follow-up subtask under this task — add the field to the interface, wire `FakeBroker.isDemo = true`, set `MT5Broker.isDemo` from a constructor flag, propagate into the existing typecheck.

---

## Task 20: `apps/paper-runner` — daily metrics writer

**Files:**
- Create: `apps/paper-runner/src/metrics-writer.ts`, `apps/paper-runner/test/metrics-writer.test.ts`

Writes `metrics-YYYYMMDD.json` (cumulative since launch) + appends a daily summary line to `paper-summary.jsonl`. Includes per-regime / per-session breakdowns, agent agreement rate, judge override rate, RO veto rate, LLM cost.

- [ ] **Step 1: Failing test** with synthetic trade list + decision counters.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run + commit**

```bash
git add apps/paper-runner
git commit -m "feat(paper-runner): add daily metrics writer"
```

---

## Task 21: `apps/paper-runner` — `main.ts`

**Files:**
- Create: `apps/paper-runner/src/main.ts`

The runnable entrypoint. Same env vars as `agent-runner` plus `PAPER_MODE=1` (required) and `PAPER_BUDGET_USD`. Wires:
- `MT5Broker` (with `isDemo: true` enforced by `assertDemoBroker`).
- `RedisHotCache`.
- `AnthropicLlm` wrapped by a budget-tracking decorator that emits to `BudgetTracker`.
- The existing `tick()` plus `detectTriggers()`.
- A daily flush hook that runs `metricsWriter.flush()` at midnight UTC.

- [ ] **Step 1: Implement** (no unit test — the e2e behavior is covered by the integration test in Task 22).
- [ ] **Step 2: Manual smoke** — `pnpm --filter @forex-bot/paper-runner start` should fail-fast without `PAPER_MODE=1`.
- [ ] **Step 3: Commit**

```bash
git add apps/paper-runner
git commit -m "feat(paper-runner): add main.ts entrypoint with paper guardrails"
```

---

## Task 22: paper-runner integration test

**Files:**
- Create: `apps/paper-runner/test/integration.test.ts`

Wires `FakeBroker` (set `isDemo: true`), `InMemoryHotCache`, `FakeLlm`, runs through 3 simulated ticks via the same `tick()` from Plan 4, asserts:
- Without `PAPER_MODE=1`, the runner refuses to boot.
- With it set, ticks fire, metrics writer accumulates, and budget tracker reports the right LLM cost.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Commit**

```bash
git add apps/paper-runner
git commit -m "test(paper-runner): integration coverage for guards + ticking"
```

---

## Task 23: CI — eval pipeline

**Files:**
- Modify: `.github/workflows/ci.yml`

Add jobs:
- **PR job — event-study subset (cheap)**: runs the 3 canonical fixtures through `apps/eval-event-study --mode cheap`. Required check.
- **Nightly cron — full event-study + 90d cheap replay**: scheduled at 04:00 UTC. Uploads reports as workflow artifacts.
- **Weekly cron — full-mode replay (curated quarter)**: scheduled Sunday 06:00 UTC. Budget-capped via env var; fails the job (loudly) if budget exceeded.

- [ ] **Step 1: Add the three jobs (cheap mode in CI runs deterministically with the LLM cache committed under `eval-cache/` for the canonical fixtures).**
- [ ] **Step 2: Run a local smoke** (`act` or `gh workflow run` if available; otherwise verify with `pnpm` commands directly).
- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add eval pipeline (PR event-study, nightly + weekly replays)"
```

---

## Task 24: README + plan-status update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add `eval-core`, `eval-replay`, `eval-event-study` rows to the package table; flip Plan 5 to done.**
- [ ] **Step 2: Add a "Running evaluations" section** with the CLI invocations and an explanation of cheap vs full mode + cache directory.
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for Plan 5"
```

---

## Done-Done Checklist

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm -r typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes (no real LLM calls).
- [ ] `pnpm --filter @forex-bot/eval-replay-cli start --help` prints usage.
- [ ] `pnpm --filter @forex-bot/eval-event-study-cli start --all --mode cheap` exits 0 against the committed cache.
- [ ] `pnpm --filter @forex-bot/paper-runner start` fails fast without `PAPER_MODE=1`.
- [ ] No package imports a sibling package except via `@forex-bot/<name>`.
- [ ] No production code uses `any`, `as unknown as`, or hardcoded model IDs other than `claude-sonnet-4-6` / `claude-opus-4-7`.
- [ ] `eval/` directory at repo root is a thin alias / docs pointer to the eval CLIs (the heavy logic lives under `packages/`).

## Deferred to future plans

- **CloudWatch + SNS metric emit.** The metrics writer is file-only in v1; CW/SNS lands in Plan 6.
- **Multi-symbol parallel replay.** Replay runs symbols sequentially; concurrency is a Plan 6 perf task.
- **Replay against partial RAG state.** v1 RAG is fixture-loaded; replaying with mid-stream RAG growth is out of scope.
- **Hyper-parameter sweeps over agent prompts.** Once the harness exists, prompt-tuning sweeps are easy — defer the orchestration.
- **Walk-forward / out-of-sample fold harness.** Add when sample size justifies it.
- **Live event-study auto-curation** (auto-detect interesting historical events from the calendar). Manual curation is fine for v1.
- **Cost-attribution per agent role**. Today the budget tracker aggregates only by total cost; per-role rollups land with telemetry expansion in Plan 6.
