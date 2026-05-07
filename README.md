# forex-bot

AI-driven forex trading system. See `prd/` for the design spec and per-plan implementation guides.

## Repository structure

- `proto/` — gRPC contract files (single source of truth).
- `mt5-sidecar/` — Python service that talks to MetaTrader 5 over gRPC.
- `packages/` — TypeScript libraries:
  - foundations: `contracts`, `indicators`, `risk`
  - execution: `broker-core`, `broker-mt5`, `executor`
  - data: `data-core`, `news-rss`, `news-api`, `calendar-forexfactory`, `cb-scrapers`, `cot`, `memory`, `cache`
  - agents: `llm-provider`, `agents`, `graph`, `telemetry`
  - eval: `eval-core`, `eval-replay`, `eval-event-study`
- `apps/` — runnable workers (`data-ingest`, `agent-runner`, `eval-replay`, `eval-event-study`, `paper-runner`).
- `infra/terraform/` — AWS Terraform IaC (Plan 6a). See `infra/terraform/README.md`.

## Local development

```bash
nvm use            # Node 20+
corepack enable
pnpm install
pnpm proto:gen     # generate ts-proto stubs (needs `protoc`)
pnpm -r typecheck
pnpm lint
pnpm test
```

### Integration tests (postgres + redis + dynamodb)

```bash
./scripts/dev-up.sh
eval "$(./scripts/dev-up.sh | grep '^export ')"
pnpm test
./scripts/dev-down.sh
```

### Python sidecar

```bash
cd mt5-sidecar
uv venv && uv pip install -e ".[dev]"
make proto
uv run pytest
```

### Running the agent locally

```bash
export MT5_HOST=127.0.0.1
export MT5_PORT=50051
export REDIS_URL=redis://localhost:6379
export ANTHROPIC_API_KEY=sk-...
export WATCHED_SYMBOLS=EURUSD,USDJPY,XAUUSD
# optional
export REDIS_NAMESPACE=forex-bot
export POLL_MS=60000
pnpm --filter @forex-bot/agent-runner start
```

The runner polls every `POLL_MS`, fires `detectTriggers` per symbol, and pipes any triggered ticks through the LangGraph agent graph to a `RiskDecision`.

### Running evaluations

Plan 5 ships three eval CLIs. All run on TS source via `tsx`; no separate build step.

**Replay** — drives `tick()` over historical bars + headlines/calendar. Cheap mode replays from a deterministic on-disk LLM cache (no real LLM calls); full mode hits Anthropic with a budget cap.

```bash
# cheap (deterministic, requires pre-populated cache)
pnpm dlx tsx apps/eval-replay/src/main.ts \
  --symbols EURUSD,USDJPY \
  --start 2024-10-01T00:00Z --end 2024-12-31T00:00Z \
  --bars-dir ./eval-fixtures/bars \
  --headlines ./eval-fixtures/headlines.json \
  --calendar ./eval-fixtures/calendar.json \
  --mode cheap --cache-dir ./.eval-cache \
  --out ./reports/replay-2024q4

# full (real LLM, budget-capped)
ANTHROPIC_API_KEY=sk-... pnpm dlx tsx apps/eval-replay/src/main.ts \
  --symbols EURUSD --start ... --end ... --bars-dir ... --mode full \
  --cache-dir ./.eval-cache --budget-usd 25 --out ./reports/full
```

**Event-study** — runs curated event fixtures (NFP, FOMC, SNB unpeg) and scores decision quality.

```bash
pnpm dlx tsx apps/eval-event-study/src/main.ts --all --mode cheap
# or single fixture:
pnpm dlx tsx apps/eval-event-study/src/main.ts --id 2015-snb-unpeg --mode cheap
```

For `--mode cheap` without an injected LLM, set `CHEAP_FAKE_LLM=1` to use the built-in always-long fake (intended for CLI plumbing checks; will fail scoring on direction-correct fixtures).

**Paper-runner** — daemon mirroring `agent-runner` but with paper guardrails (forced demo broker, budget cap, daily metric snapshots). Refuses to start unless `PAPER_MODE=1` and `MT5_DEMO=1`.

```bash
PAPER_MODE=1 PAPER_BUDGET_USD=50 MT5_DEMO=1 \
MT5_HOST=127.0.0.1 MT5_PORT=50051 REDIS_URL=redis://localhost:6379 \
ANTHROPIC_API_KEY=sk-... WATCHED_SYMBOLS=EURUSD,USDJPY \
PAPER_OUT_DIR=./paper-out \
pnpm --filter @forex-bot/paper-runner start
```

Daily snapshots land in `$PAPER_OUT_DIR/metrics-YYYYMMDD.json` plus an append-only `$PAPER_OUT_DIR/paper-summary.jsonl`. CW/SNS emit lands in Plan 6.

## Plans

Each implementation plan in `prd/plans/` produces working, testable software on its own. Execute them in order via `superpowers:executing-plans` or `superpowers:subagent-driven-development`.

| Plan | Status | Scope |
|------|--------|-------|
| 1 — Foundations | done | contracts, indicators, risk |
| 2 — MT5 Bridge & Executor | done | proto, broker-core, broker-mt5, executor, mt5-sidecar |
| 3 — Data Layer | done | adapters, memory, cache, data-ingest |
| 4 — Agent Graph | done | LangGraph, agents, agent-runner |
| 5 — Eval Harness | done | replay, event-study, paper |
| 6a — IaC base | done | VPC, RDS, Redis, DynamoDB, Secrets, ECR, GH OIDC |
| 6b — Sidecar deploy | pending | Wine + portable MT5 + ECS task |
| 6c — App deploy | pending | ECS clusters/services for agent-runner, paper-runner, ingest |
| 6d — Observability | pending | CW metrics, SNS alerts, dashboards |
| 6e — ops-cli | pending | kill-switch, reconcile, RAG backfill |
| 7 — Go-Live Controls | pending | canary, chaos drills, gates |
