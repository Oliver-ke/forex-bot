# forex-bot

AI-driven forex trading system. See `prd/` for the design spec and per-plan implementation guides.

## Repository structure

- `proto/` — gRPC contract files (single source of truth).
- `mt5-sidecar/` — Python service that talks to MetaTrader 5 over gRPC.
- `packages/` — TypeScript libraries:
  - foundations: `contracts`, `indicators`, `risk`
  - execution: `broker-core`, `broker-mt5`, `executor`
  - data: `data-core`, `news-rss`, `news-api`, `calendar-forexfactory`, `cb-scrapers`, `cot`, `memory`, `cache`
- `apps/` — runnable workers (`data-ingest`).
- `eval/` — backtest/replay harnesses (future plan).
- `infra/` — IaC (future plan).

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

## Plans

Each implementation plan in `prd/plans/` produces working, testable software on its own. Execute them in order via `superpowers:executing-plans` or `superpowers:subagent-driven-development`.

| Plan | Status | Scope |
|------|--------|-------|
| 1 — Foundations | done | contracts, indicators, risk |
| 2 — MT5 Bridge & Executor | done | proto, broker-core, broker-mt5, executor, mt5-sidecar |
| 3 — Data Layer | done | adapters, memory, cache, data-ingest |
| 4 — Agent Graph | pending | LangGraph, agents, agent-runner |
| 5 — Eval Harness | pending | replay, event-study, paper |
| 6 — Infra & Ops | pending | IaC, ops-cli, observability |
| 7 — Go-Live Controls | pending | canary, chaos drills, gates |
