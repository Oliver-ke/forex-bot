# AI Forex Trading Bot — Design Spec

**Status:** Draft for review
**Date:** 2026-04-21
**Owner:** kelechiolivera

## 1. Summary

An agentic forex trading bot that autonomously analyzes markets across three pillars — price/technical, fundamental/economic, and news/sentiment — reasons about trade setups via a hybrid council-and-debate agent system, sizes positions through a layered risk engine, and executes orders on MetaTrader 5. TypeScript is the primary language for the agent system, risk engine, and execution layer. A small Python sidecar bridges to the MT5 terminal. LangGraph.js orchestrates agent workflow. Claude models (Sonnet 4.6 for analysts, Opus 4.7 for judge and risk officer) provide reasoning. Deployment is AWS ECS, broker-region, fully autonomous with hard circuit breakers.

## 2. Goals

- Produce a trading system whose decisions are **auditable** — every trade comes with a full reasoning trail (analyst outputs, debate transcript, risk vetoes).
- Exploit structural gaps in existing retail FX bots: regime-agnostic indicators, absence of macro/sentiment reasoning, missing hard risk controls.
- Run unattended within risk bounds; never risk more than configured % per trade; halt cleanly on degraded conditions.
- Support tiered evaluation (unit → integration → historical replay → event study → paper trade → canary live) before any real capital.
- Keep infra pragmatic: single cloud region, containerized, observable via LangSmith + CloudWatch.

## 3. Non-goals

- High-frequency / sub-second scalping (latency budget not designed for it).
- Trading equities, indices, or crypto as primary assets (metals included as FX adjacency).
- Manual HITL approval workflow (full-auto by design; kill-switches replace human gating).
- Self-training / reinforcement learning loop (reflection-based memory only).
- Multi-tenant / multi-account support in v1.

## 4. Context and research

### 4.1 Existing agentic trading systems reviewed

| System | Approach | Lesson applied |
|---|---|---|
| TradingAgents (Yu et al. 2024) | Council of analysts → Bull/Bear debate → Trader → Risk team → PM | Adopted as base topology. Debate-on-contested keeps cost down. |
| FinRobot (AI4Finance 2024) | Multi-agent, chain-verified CoT | Verification pattern applied to numeric claims in agent outputs via Zod structured outputs. |
| FinMem (Yu et al. 2023) | Layered memory + reflection | Adopted: journal RAG + post-trade reflection writes to vector memory. |
| OpenBB Agents | Tool-calling agent over structured data | Data-adapter pattern generalized; reasoning strengthened vs OpenBB. |
| Retail MT5 EAs | Hard-coded indicators | Treated as baseline to beat; weakness = regime change handling. |

### 4.2 Identified gaps (our edge opportunity)

1. Most academic agentic bots target equities/crypto. FX has different microstructure (24/5 sessions, macro-driven flow).
2. LLMs cannot be trusted unsupervised with capital — most published systems lack hard risk circuit breakers. Ours enforces 9 pre-LLM hard rules plus the kill-switch as a separate gate layer.
3. Most bots are regime-agnostic. A `RegimeNode` classifies trending / ranging / event-driven / risk-off and is available as context to every analyst.
4. Multi-timeframe confluence is under-exploited. TA analyst receives M15/H1/H4/D1 structure as first-class input.
5. Correlation blindness causes double-risk in retail bots. Our risk engine enforces net correlated exposure cap.

## 5. Architectural decisions (from brainstorming 2026-04-21)

| Area | Decision |
|---|---|
| Broker | MetaTrader 5 |
| Trading style | Mixed-timeframe; agent classifies regime + picks horizon per setup |
| Assets | FX majors + crosses + metals (XAUUSD, XAGUSD) |
| Risk profile | Config-driven per deployment (conservative / standard / prop_challenge) |
| Agent topology | Hybrid: specialist council + Bull/Bear debate on contested setups |
| Orchestration | LangGraph.js |
| LLM backbone | Claude-only — Sonnet 4.6 for analysts & debaters, Opus 4.7 for judge + risk officer |
| HITL | Full auto — no approval gate. Hard kill-switches replace human gating. |
| Memory | Trade journal RAG + post-close reflection agent |
| MT5 bridge | Python sidecar using `MetaTrader5` package, exposed via gRPC |
| Data sources | Provider-adapter pattern; start free (MT5, ForexFactory, Reuters/FT RSS, central-bank pages), upgrade without rewrite |
| Deployment | AWS ECS, broker-region, containerized |
| Observability | CloudWatch (logs + metrics) + LangSmith (agent traces) + SNS (email alerts) |
| News sources | Economic calendar + headlines + central-bank press/speech transcripts. Social media excluded. |
| Eval strategy | Tiered — unit, graph integration, historical replay, event study, paper trade, canary live |
| Primary language | TypeScript (agent system, risk, executor). Python only for MT5 sidecar. |

## 6. System architecture

```
AWS ECS, broker-region

 ┌─────────────────┐   gRPC     ┌───────────────────────────┐
 │ mt5-sidecar     │◄──────────►│ fx-core (TypeScript)      │
 │ (Python, Wine)  │            │  - LangGraph.js graph     │
 │ - MetaTrader5   │            │  - Risk engine (pure)     │
 │ - quotes stream │            │  - Executor               │
 │ - order exec    │            └───────────────────────────┘
 │ - account state │                          │
 └─────────────────┘                          │
                                              │
 ┌─────────────────┐                          │
 │ data-ingest     │───Redis────────────────►│
 │ (TypeScript)    │                          │
 │ - calendar poll │                          │
 │ - news RSS      │                          │
 │ - CB transcripts│                          │
 └─────────────────┘                          │
                                              ▼
          ┌─────────────┐   ┌──────────────┐   ┌────────────────┐
          │ DynamoDB    │   │ pgvector RDS │   │ Secrets Mgr    │
          │ trade log   │   │ journal RAG  │   │ broker, Claude │
          └─────────────┘   └──────────────┘   └────────────────┘

          LangSmith (agent traces) + CloudWatch + SNS (email)
```

### 6.1 Services

- **mt5-sidecar** — Python container. Linux+Wine runs the MT5 terminal. Exposes gRPC methods: `GetQuote`, `GetCandles`, `GetAccount`, `PlaceOrder`, `ModifyOrder`, `ClosePosition`, `StreamTicks`. Separately versioned and deployed.
- **fx-core** — TypeScript monorepo. Houses the LangGraph.js agent graph, risk engine, executor, all adapters. Single long-running process per deployment.
- **data-ingest** — TypeScript worker(s). Scheduled polling of calendar, news, and central-bank sources. Normalizes payloads, writes to Redis (hot cache) and pgvector (embeddings for RAG).
- **Redis** (AWS ElastiCache) — hot cache: latest candles, active calendar events, recent headlines, account state snapshot.
- **DynamoDB** — trade journal, agent decision records, kill-switch state.
- **pgvector on RDS Postgres** — RAG store: past trade reflections, CB transcript embeddings, headline embeddings.
- **AWS Secrets Manager** — broker credentials, Anthropic API key.

### 6.2 Isolation boundaries

Services are separated because their cadences differ: tick rates for market data are milliseconds, news polling is minutes, calendar is 15 minutes, agent graph invocations are tied to bar closes and events. Each service scales independently. The sidecar is isolated so bridge changes (e.g., a swap to MetaApi or cTrader) do not touch agent code.

## 7. Components

### 7.1 Directory layout (fx-core monorepo)

```
fx-core/
├── apps/
│   ├── agent-runner/     # main process: tick loop, graph invocation
│   ├── data-ingest/      # news/calendar/CB workers
│   └── ops-cli/          # kill-switch, flatten-all, replay
├── packages/
│   ├── graph/            # LangGraph.js nodes + edges
│   ├── agents/           # prompt templates + agent wrappers
│   ├── risk/             # pure risk engine (heavily tested)
│   ├── executor/         # order state machine
│   ├── adapters/
│   │   ├── broker-mt5/   # gRPC client to Python sidecar
│   │   ├── news/         # RSS, NewsAPI, CB scrapers (one adapter each)
│   │   ├── calendar/     # ForexFactory, Trading Economics
│   │   └── market/       # candle fetcher (MT5 via sidecar)
│   ├── memory/           # journal writer + RAG retriever
│   ├── indicators/       # TA calcs (EMA, ATR, ADX, RSI, S/R)
│   ├── contracts/        # Zod schemas shared across packages
│   └── telemetry/        # LangSmith, CloudWatch, SNS
├── mt5-sidecar/          # Python service (separate deploy artifact)
├── infra/                # CDK or Terraform
└── eval/
    ├── replay/           # historical bar replay harness
    ├── event-study/      # curated historical setups
    └── paper/            # live paper-trade runner
```

### 7.2 Agent graph (LangGraph.js)

```
TickTrigger → DataLoader → RegimeNode
           → [TA Analyst | Fundamental Analyst | Sentiment Analyst]  (parallel)
           → Aggregator → ConsensusCheck
              ├─ consensus → Risk Officer → Executor → Journal
              └─ contested → [Bull | Bear] ×N rounds → Judge → Risk Officer → Executor → Journal

Async, post-close: Reflection → RAG
```

### 7.3 Agent briefs

| Agent | Model | Input | Output |
|---|---|---|---|
| RegimeNode | rule + Sonnet | ATR, ADX, realized vol, recent calendar intensity | `{regime, vol_bucket}` |
| TA Analyst | Sonnet 4.6 | MTF candles + indicators (EMA, RSI, ATR, S/R, market structure) | `{bias, setup_type, key_levels, conviction}` |
| Fundamental Analyst | Sonnet 4.6 | Rate differentials, next 48h calendar, COT positioning, macro surprise index | `{bias, drivers[], event_risks[], conviction}` |
| Sentiment Analyst | Sonnet 4.6 | Headlines last 24h, CB speech snippets, RAG of similar past events | `{tone, hawkish_dovish_shift, narrative, conviction}` |
| Aggregator | pure TS | 3 analyst outputs | normalized signal vector |
| Bull / Bear | Sonnet 4.6 | All analyst outputs + own-side mandate | arguments, risks, counters |
| Judge | Opus 4.7 | Debate transcript | `{verdict, confidence, reasoning}` |
| Risk Officer | Opus 4.7 + rules | verdict + account state + open positions + correlation matrix | `{approve, lot_size, SL, TP, expiry, reasons[], veto_reason?}` |
| Executor | pure TS | risk-approved order | broker result + order id |
| Reflection | Opus 4.7 | closed trade + original reasoning | lesson text → RAG |

### 7.4 Shared contracts (Zod)

```typescript
StateBundle      // full input to agent graph per tick
AnalystOutput    // { bias, conviction, reasoning, evidence[] }
Verdict          // { direction, confidence, reasoning, horizon }
RiskDecision     // { approve, lotSize, sl, tp, expiry, vetoReason? }
TradeJournal     // entry decision + execution + outcome
```

All LLM outputs validated against Zod schemas via structured outputs. Malformed → retry once → fail-closed (no trade).

## 8. Data flow

### 8.1 Streams (hot path)

| Source | Cadence | Path | Consumer |
|---|---|---|---|
| MT5 tick stream | real-time | sidecar → gRPC server-stream → fx-core → Redis | TickTrigger |
| MT5 candles | on M15/H1/H4 close | fx-core polls sidecar → Redis | DataLoader |
| Account state | 30 s | fx-core polls sidecar → Redis | Risk engine |

### 8.2 Pulls (cold path)

| Source | Cadence | Path | Consumer |
|---|---|---|---|
| Economic calendar | 15 min | data-ingest → adapter → Redis + DynamoDB | Fundamental Analyst |
| News RSS (Reuters/FT) | 5 min | data-ingest → adapter → Redis (last 24h) + pgvector | Sentiment Analyst |
| NewsAPI | 15 min | data-ingest → adapter → same pipe | Sentiment Analyst |
| CB press releases (Fed, ECB, BoE, BoJ, SNB, RBA, RBNZ) | 60 min | data-ingest → scraper → pgvector | Sentiment Analyst (RAG) |
| CB speech transcripts (same set) | daily + event-driven | data-ingest → scraper → pgvector | Sentiment Analyst (RAG) |
| COT report | weekly (Fri) | data-ingest → CFTC → DynamoDB | Fundamental Analyst |

### 8.3 Tick-trigger rules

The graph does not run tick-by-tick. Triggers:

1. **Scheduled** — M15, H1, H4 close on each watched symbol.
2. **Price-event** — S/R break, ATR-expansion spike, sudden momentum flip (rule-based detector, no LLM).
3. **News-event** — high-impact calendar release within ±W minutes OR CB press feed drop.
4. **Rebalance** — portfolio check every 30 min (correlation drift, trailing stops).

### 8.4 Per-invocation flow

1. TickTrigger fires with `{symbol, reason}`.
2. DataLoader assembles StateBundle: MTF candles, indicators, news_24h, calendar_48h, account, open_positions, regime_prior.
3. RegimeNode → `{regime, vol_bucket}` (cached 15 min, recomputed on event).
4. Parallel fanout: TA + Fundamental + Sentiment.
5. Aggregator normalizes → ConsensusCheck.
6. If all three same direction + conviction ≥ `consensus_threshold` → skip debate. Else → Bull+Bear N rounds → Judge.
7. Verdict → hard-rule risk gate (9 rules, see §9.2) → Risk Officer LLM → sized order OR veto.
8. Executor: pre-fire checks (live spread, margin, feed age ≤ 500 ms) → `sidecar.PlaceOrder`.
9. Journal writes the full decision tree to DynamoDB and embeds the rationale in pgvector.
10. LangSmith trace + CloudWatch metrics emitted.

### 8.5 Post-trade flow

Position closed (fill event) → journal updater computes realized R, MAE, MFE → Reflection agent reads entry decision + outcome + RAG-retrieved similar past trades → writes lesson doc to pgvector (tagged: symbol, regime, setup_type, result) → future analysts retrieve on similar setups.

### 8.6 Fail-closed defaults

- Stale feed > 30 s → no new trades, alert.
- LLM call fails twice → no trade, alert.
- Broker reject → log + retry with exponential backoff (max 3) → alert.
- pgvector down → skip RAG, continue (degraded, not blocking).
- Redis down → cold-path fallback (slower but safe).

## 9. Risk engine

### 9.1 Config (per-deployment YAML)

```yaml
account:
  profile: standard
  max_daily_loss_pct: 3.0
  max_total_drawdown_pct: 8.0
  max_consecutive_losses: 4
  max_concurrent_positions: 4
  max_exposure_per_currency_pct: 6.0

per_trade:
  risk_pct: 1.0
  min_rr: 1.5
  max_lot_size: 2.0

execution:
  max_spread_multiplier: 2.0
  min_stop_distance_atr: 0.5
  slippage_tolerance_pips: 2

news_blackout:
  high_impact_window_min: 10
  post_release_calm_min: 5

sessions:
  asia:   { allowed: [USDJPY, AUDUSD, NZDUSD, XAUUSD] }
  london: { allowed: all }
  ny:     { allowed: all }
  overlap_ny_london: { size_multiplier: 1.2 }

correlation:
  matrix_refresh_days: 7
  max_net_correlated_exposure_pct: 4.0

agent:
  consensus_threshold: 0.7
  debate_max_rounds: 2
  llm_timeout_ms: 30000
  llm_retry_count: 1

kill_switch:
  triggers:
    - daily_dd_pct_exceeded
    - total_dd_pct_exceeded
    - consecutive_losses_exceeded
    - feed_stale_sec: 30
    - unhandled_error_rate_per_hour: 5
  action: close_all_and_halt
```

### 9.2 Layered defense

1. **Config sanity (boot time)** — schema validation; impossible values rejected.
2. **Pre-graph gates** — account healthy, feed fresh, kill-switch not tripped; otherwise no tick.
3. **Hard rules (pre-LLM)** — 9 gates: kill-switch, spread guard, session guard, news blackout, correlation cap, per-currency exposure cap, concurrent-position cap, per-trade risk cap, margin buffer. Blocked setups never reach the LLM.
4. **Risk Officer LLM** — reasoning layer: can tighten size or veto; cannot loosen.
5. **Executor pre-fire** — last-500 ms re-check of spread, margin, feed age; on drift → abort.
6. **Post-fire reconciliation** — every 30 s compare sidecar positions vs. fx-core expected state; divergence → alert + reconcile.

### 9.3 Kill-switch mechanics

- State in DynamoDB (atomic read/write). Every tick reads before deciding.
- Auto trip on any Layer-3/5 breach or configured trigger.
- Manual trip via `ops-cli halt`; optionally flattens all positions.
- Reset is manual only — `ops-cli resume --confirm`.

### 9.4 Ops CLI

```
ops-cli halt              # trip kill-switch, stop new trades
ops-cli flatten           # close all open positions
ops-cli resume            # reset kill-switch (requires --confirm)
ops-cli status            # account, positions, recent decisions, switch state
ops-cli replay <tradeId>  # re-run agent graph on historical state for that trade
ops-cli journal --last N  # dump last N decisions with reasoning
```

### 9.5 Secrets and logging

- Secrets in AWS Secrets Manager; IAM task role scoped per secret; loaded on boot into memory; never logged.
- Every LLM call → LangSmith (prompt, output, tokens, latency).
- Every trade decision → DynamoDB (full StateBundle + agent outputs + verdict + execution).
- CloudWatch: structured JSON logs + custom metrics (P&L, DD, tick count, LLM cost, agent latency, reject rates).

### 9.6 Alerts (SNS → email)

- **Immediate:** kill-switch tripped, any broker reject, feed stale > 60 s, LLM outage > 5 min.
- **Digest, hourly:** DD approaching 50% of cap, consecutive losses ≥ 2, LLM cost spike.

### 9.7 Go-live gating

Paper → live promotion requires:
1. ≥ 60 paper days on demo.
2. Sharpe ≥ 1.0, profit factor ≥ 1.3 on paper.
3. Max paper DD ≤ 60% of configured total DD cap.
4. All event-study trades replayable without divergence.
5. Kill-switch tested live in staging.
6. Cost per decision ≤ budget.

## 10. Testing and evaluation

### 10.1 Tier 1 — Unit + property

- `packages/risk/` — property tests on lot sizing (never exceeds `risk_pct × equity`), correlation math, kill-switch triggers. Target 100% branch coverage.
- `packages/indicators/` — golden tests vs. TA-Lib reference.
- `packages/executor/` — order state machine tested with fake broker.
- `packages/adapters/` — contract tests per adapter.
- Zod contracts — round-trip + malformed-input rejection.

### 10.2 Tier 2 — Graph integration

- Fake LLM (canned responses) + fake broker + fixture StateBundles.
- Scenarios: consensus, debate, risk veto, hard-rule block, kill-switch mid-tick.

### 10.3 Tier 3 — Historical replay

- `eval/replay/` runs graph against archived bars.
- **Cheap mode** — mock LLM (deterministic cache); validates code + risk over months.
- **Full mode** — real LLM; run on curated windows (e.g., 2024 Q4, US election, BoJ pivots). Budget-capped.
- Outputs: P&L curve, DD curve, trade list, per-setup R distribution, Sharpe, profit factor.

### 10.4 Tier 4 — Event-study harness

- `eval/event-study/` — curated library: NFP ±30 min, FOMC, SNB unpeg 2015, flash crashes, BoJ YCC shifts, etc.
- Each with snapshot of prices + news + calendar at event T.
- Graph runs with real LLM; decision scored vs. actual subsequent move.
- Run on every PR that touches agent prompts or graph structure.

### 10.5 Tier 5 — Paper trading

- `eval/paper/` — full live pipeline, MT5 demo, real data, real LLM, no real money.
- Daily metrics: P&L, DD, Sharpe, profit factor, win rate, avg R, expectancy; per-regime / per-session / per-pair breakdowns; agent agreement rate, judge override rate, Risk Officer veto rate; LLM cost per decision/trade/day.
- Minimum 60 days before live gate.

### 10.6 Tier 6 — Chaos drills

Run on staging before live:
- Kill sidecar mid-order → Executor times out cleanly, no phantom position.
- Kill Redis → cold-path fallback works.
- Block Anthropic API → fail-closed, alert fires.
- Inject stale feed → tick blocked.
- Malformed LLM output → Zod retry + fail-closed.
- Trigger kill-switch live → positions flatten, alerts fire.

### 10.7 Tier 7 — Canary live

- Week 1: 10% of configured `risk_pct`, one pair only (EURUSD).
- Expand pairs + risk stepwise per weekly review.

### 10.8 CI pipeline

```
PR → typecheck → lint → unit+property → graph integration (fake LLM)
   → event-study subset (3 canonical events, real LLM, budget-capped) → merge
Nightly → full event-study → historical replay (cheap mode, last 90d)
Weekly → historical replay (full mode, curated quarter)
```

## 11. Open questions

- Exact choice of MT5 container base: Windows Fargate (costlier, native) vs. Linux+Wine (cheaper, flakier). Benchmark during Phase 1.
- Whether to run `fx-core` as a single Fargate task or split `agent-runner` / `data-ingest` into separate tasks. Likely split.
- Embedding model for pgvector (Voyage vs. OpenAI vs. local). Defer decision to Phase 1.
- Whether Risk Officer LLM sees open-position P&L at decision time or only pre-trade state (affects whether it can reason about scaling vs. reducing exposure). Default: yes, sees everything.
- COT report value for intraday style — may drop if noisy in backtests.

## 12. Out of scope (explicit)

- Equities, indices, crypto.
- User-facing dashboard (CLI + LangSmith + CloudWatch only in v1).
- Strategy marketplace / multiple strategy variants.
- Client/account onboarding flows.
- Mobile notifications beyond SNS email.
- Tax/accounting export.
