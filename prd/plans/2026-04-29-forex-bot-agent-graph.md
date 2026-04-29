# Forex Bot — Plan 4: Agent Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the agent graph: a `LlmProvider` interface (with `FakeLlm` for tests + `AnthropicLlm` over the official SDK), one wrapper package per agent role (Regime, three analysts, Aggregator, Bull/Bear, Judge, Risk Officer LLM, Reflection), a LangGraph.js graph that routes consensus vs. debate, an `agent-runner` app that assembles a `StateBundle` per tick and produces a `RiskDecision`. No real LLM calls in any test.

**Architecture:**
- `packages/llm-provider` — `LlmProvider` interface (structured outputs by Zod schema), `FakeLlm` for unit tests, `AnthropicLlm` using `@anthropic-ai/sdk` with adaptive thinking + prompt caching + `output_config.format` (canonical structured-output API) via `zodOutputFormat`.
- `packages/agents` — one wrapper per agent. Each wrapper: builds system + user messages from inputs, calls `LlmProvider.structured(...)` with the right model + Zod schema, returns the validated output. Aggregator and a small RegimeNode rule layer are pure TS (no LLM).
- `packages/graph` — LangGraph.js StateGraph. Nodes invoke agent wrappers; edges route based on `ConsensusCheck`. Fail-closed on Zod errors (one retry, then veto).
- `packages/telemetry` — structured logger + LangSmith client wrapper (optional, gated on env var). CloudWatch + SNS deferred to Plan 6.
- `apps/agent-runner` — tick loop with trigger detection (M15/H1/H4 close, price events, news events, 30-min rebalance), `StateBundle` assembler that pulls from Plan 2's `Broker` + Plan 3's `HotCache`, end-to-end wiring through the graph to `evaluate()` from Plan 1.

**Model choices (per design spec §5):**
- Sonnet 4.6 (`claude-sonnet-4-6`) for analysts + Bull/Bear debaters.
- Opus 4.7 (`claude-opus-4-7`) for Judge + Risk Officer LLM + Reflection.
- Adaptive thinking on every LLM call. `effort: "high"` default for analysts; `effort: "xhigh"` for Opus tasks.

**Tech Stack:** existing TS toolchain + `@anthropic-ai/sdk@^0.30`, `@langchain/langgraph@^0.2`, `zod@^3.23` (already a dep via contracts).

---

## File structure produced by this plan

```
forex-bot/
├── packages/
│   ├── llm-provider/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── provider.ts
│   │   │   ├── fake-llm.ts
│   │   │   ├── anthropic-llm.ts
│   │   │   └── index.ts
│   │   └── test/
│   ├── agents/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── prompts/{regime,ta,fundamental,sentiment,bull,bear,judge,risk-officer,reflection}.ts
│   │   │   ├── regime.ts
│   │   │   ├── ta-analyst.ts
│   │   │   ├── fundamental-analyst.ts
│   │   │   ├── sentiment-analyst.ts
│   │   │   ├── aggregator.ts
│   │   │   ├── debater.ts
│   │   │   ├── judge.ts
│   │   │   ├── risk-officer.ts
│   │   │   ├── reflection.ts
│   │   │   └── index.ts
│   │   └── test/
│   ├── graph/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── state.ts
│   │   │   ├── nodes.ts
│   │   │   ├── build-graph.ts
│   │   │   └── index.ts
│   │   └── test/
│   └── telemetry/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/{logger.ts,langsmith.ts,index.ts}
│       └── test/
└── apps/
    └── agent-runner/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── triggers.ts
        │   ├── state-assembler.ts
        │   ├── tick.ts
        │   ├── main.ts
        │   └── index.ts
        └── test/
```

---

## Task 1: `llm-provider` — interface + types

**Files:**
- Create: `packages/llm-provider/{package.json,tsconfig.json,src/{types.ts,provider.ts,index.ts}}`

- [ ] **Step 1: Write `packages/llm-provider/package.json`**

```json
{
  "name": "@forex-bot/llm-provider",
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
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template — same as other workspace packages)

- [ ] **Step 3: Write `packages/llm-provider/src/types.ts`**

```ts
import type { ZodSchema } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface StructuredRequest<T> {
  /** Model id, e.g. "claude-opus-4-7" or "claude-sonnet-4-6". */
  model: string;
  /** System prompt — long stable content; cached when supported. */
  system: string;
  /** Per-tick user message — short, varying. Goes after the cache breakpoint. */
  user: string;
  /** Zod schema the response is validated against. Errors trigger one retry. */
  schema: ZodSchema<T>;
  /** Default "adaptive". Use "disabled" for pure-throughput nodes. */
  thinking?: "adaptive" | "disabled";
  /** Default "high". Set "xhigh"/"max" for Opus-tier tasks. */
  effort?: Effort;
  /** Default 16_000. Streamed transparently when above 16k. */
  maxTokens?: number;
  /** Default true; turn off for tiny/non-stable system prompts (< 1024 tokens). */
  cacheSystem?: boolean;
  /** Telemetry hook: surfaces token usage + cache hit/miss. */
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export class LlmValidationError extends Error {
  readonly code = "validation" as const;
  constructor(
    message: string,
    public readonly attemptCount: number,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = "LlmValidationError";
  }
}

export class LlmTransportError extends Error {
  readonly code = "transport" as const;
  constructor(message: string) {
    super(message);
    this.name = "LlmTransportError";
  }
}

export class LlmRefusalError extends Error {
  readonly code = "refusal" as const;
  constructor(message: string) {
    super(message);
    this.name = "LlmRefusalError";
  }
}
```

- [ ] **Step 4: Write `packages/llm-provider/src/provider.ts`**

```ts
import type { StructuredRequest } from "./types.js";

export interface LlmProvider {
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}
```

- [ ] **Step 5: Write `packages/llm-provider/src/index.ts`**

```ts
export * from "./provider.js";
export * from "./types.js";
```

- [ ] **Step 6: Install + typecheck**

Run: `pnpm install && pnpm --filter @forex-bot/llm-provider typecheck`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-provider pnpm-lock.yaml
git commit -m "feat(llm-provider): scaffold LlmProvider interface + structured request types"
```

---

## Task 2: `llm-provider` — `FakeLlm`

**Files:**
- Create: `packages/llm-provider/src/fake-llm.ts`, `packages/llm-provider/test/fake-llm.test.ts`
- Modify: `packages/llm-provider/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/llm-provider/test/fake-llm.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLlm, LlmValidationError } from "../src/index.js";

const Out = z.object({ bias: z.enum(["long", "short"]), conviction: z.number() });

describe("FakeLlm", () => {
  it("dispatches by routing function and validates the response", async () => {
    const llm = new FakeLlm({
      route: (req) => {
        if (req.system.includes("technical")) return { bias: "long", conviction: 0.7 };
        return { bias: "short", conviction: 0.3 };
      },
    });
    const out = await llm.structured({
      model: "claude-sonnet-4-6",
      system: "You are a technical analyst.",
      user: "EURUSD H1.",
      schema: Out,
    });
    expect(out.bias).toBe("long");
  });

  it("throws LlmValidationError when the routed value fails schema", async () => {
    const llm = new FakeLlm({ route: () => ({ bias: "sideways", conviction: 0.5 }) });
    await expect(
      llm.structured({
        model: "claude-sonnet-4-6",
        system: "x",
        user: "y",
        schema: Out,
      }),
    ).rejects.toBeInstanceOf(LlmValidationError);
  });

  it("records call history for per-test assertions", async () => {
    const llm = new FakeLlm({ route: () => ({ bias: "long", conviction: 0.9 }) });
    await llm.structured({ model: "claude-opus-4-7", system: "s", user: "u", schema: Out });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.model).toBe("claude-opus-4-7");
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

Run: `pnpm vitest run packages/llm-provider/test/fake-llm.test.ts`

- [ ] **Step 3: Write `packages/llm-provider/src/fake-llm.ts`**

```ts
import type { LlmProvider } from "./provider.js";
import { LlmValidationError, type StructuredRequest } from "./types.js";

export interface FakeLlmOptions {
  /** Maps each request to an unvalidated response object. */
  route: (req: StructuredRequest<unknown>) => unknown;
}

export interface FakeLlmCall {
  model: string;
  system: string;
  user: string;
}

export class FakeLlm implements LlmProvider {
  readonly calls: FakeLlmCall[] = [];
  private readonly opts: FakeLlmOptions;

  constructor(opts: FakeLlmOptions) {
    this.opts = opts;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.calls.push({ model: req.model, system: req.system, user: req.user });
    const raw = this.opts.route(req as StructuredRequest<unknown>);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmValidationError(
        `FakeLlm response failed schema: ${parsed.error.message}`,
        1,
        raw,
      );
    }
    return parsed.data;
  }
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./fake-llm.js";
export * from "./provider.js";
export * from "./types.js";
```

- [ ] **Step 5: Run test (PASS)**

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider
git commit -m "feat(llm-provider): add FakeLlm with route hook for test fixtures"
```

---

## Task 3: `llm-provider` — `AnthropicLlm`

**Files:**
- Create: `packages/llm-provider/src/anthropic-llm.ts`, `packages/llm-provider/test/anthropic-llm.types.test.ts`
- Modify: `packages/llm-provider/{package.json,src/index.ts}`

This task ships the SDK wrapper. Behavior is verified via the agent tests against `FakeLlm` (Task 5+); this test only confirms construction + signature so we don't accidentally hit the network from CI.

- [ ] **Step 1: Add Anthropic SDK to `packages/llm-provider/package.json`**

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.30.0",
  "@forex-bot/contracts": "workspace:*",
  "zod": "^3.23.0"
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the typecheck-only test `packages/llm-provider/test/anthropic-llm.types.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlm } from "../src/anthropic-llm.js";

describe("AnthropicLlm", () => {
  it("constructs without contacting the API", () => {
    const llm = new AnthropicLlm({ apiKey: "sk-fake" });
    expect(llm).toBeInstanceOf(AnthropicLlm);
  });

  it("structured() returns a Promise<T> typed by the schema", () => {
    const llm = new AnthropicLlm({ apiKey: "sk-fake" });
    const Out = z.object({ x: z.number() });
    // Compile-time check only: the next line must type-check; no .then() so we don't fire.
    const _: () => Promise<{ x: number }> = () =>
      llm.structured({
        model: "claude-sonnet-4-6",
        system: "s",
        user: "u",
        schema: Out,
      });
    expect(_).toBeTypeOf("function");
  });
});
```

- [ ] **Step 3: Write `packages/llm-provider/src/anthropic-llm.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmProvider } from "./provider.js";
import {
  LlmRefusalError,
  LlmTransportError,
  LlmValidationError,
  type StructuredRequest,
} from "./types.js";

export interface AnthropicLlmOptions {
  /** Pass-through to the SDK. Defaults to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Defaults to 1 — one retry on Zod failure, then throw. */
  maxValidationRetries?: number;
}

export class AnthropicLlm implements LlmProvider {
  private readonly client: Anthropic;
  private readonly maxValidationRetries: number;

  constructor(opts: AnthropicLlmOptions = {}) {
    this.client = new Anthropic({ ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) });
    this.maxValidationRetries = opts.maxValidationRetries ?? 1;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const cacheSystem = req.cacheSystem ?? true;
    const thinking = req.thinking ?? "adaptive";
    const effort = req.effort ?? "high";
    const maxTokens = req.maxTokens ?? 16_000;

    let lastRaw: unknown = undefined;
    for (let attempt = 0; attempt <= this.maxValidationRetries; attempt++) {
      let response;
      try {
        response = await this.client.messages.parse({
          model: req.model,
          max_tokens: maxTokens,
          system: cacheSystem
            ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }]
            : req.system,
          messages: [{ role: "user", content: req.user }],
          ...(thinking === "adaptive" ? { thinking: { type: "adaptive" } } : { thinking: { type: "disabled" } }),
          output_config: {
            effort,
            format: zodOutputFormat(req.schema),
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new LlmTransportError(msg);
      }

      if (response.stop_reason === "refusal") {
        throw new LlmRefusalError("model refused to respond");
      }

      req.onUsage?.({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      });

      const parsed = response.parsed_output as T | null;
      if (parsed !== null) return parsed;

      // parse() returns null only when SDK validation fails — surface to retry.
      lastRaw = response.content;
    }
    throw new LlmValidationError(
      "Anthropic structured output failed validation after retries",
      this.maxValidationRetries + 1,
      lastRaw,
    );
  }
}
```

> Notes: `messages.parse()` is the recommended structured-output API; it does the schema validation server-side and returns `parsed_output` typed to the schema. We retry once because flaky validation does occasionally happen on edge cases (long enums, nested unions).

- [ ] **Step 4: Update index**

```ts
export * from "./anthropic-llm.js";
export * from "./fake-llm.js";
export * from "./provider.js";
export * from "./types.js";
```

- [ ] **Step 5: Typecheck + run tests**

Run: `pnpm --filter @forex-bot/llm-provider typecheck && pnpm vitest run packages/llm-provider`
Expected: typecheck OK; FakeLlm tests + AnthropicLlm types test green; no network calls.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider pnpm-lock.yaml
git commit -m "feat(llm-provider): add AnthropicLlm using messages.parse + zodOutputFormat"
```

---

## Task 4: `agents` package scaffold + helpers

**Files:**
- Create: `packages/agents/{package.json,tsconfig.json,src/{prompts/index.ts,index.ts}}`

- [ ] **Step 1: Write `packages/agents/package.json`**

```json
{
  "name": "@forex-bot/agents",
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
    "@forex-bot/data-core": "workspace:*",
    "@forex-bot/indicators": "workspace:*",
    "@forex-bot/llm-provider": "workspace:*",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template).

- [ ] **Step 3: Stub indexes**

```ts
// src/index.ts
export {};
```

```ts
// src/prompts/index.ts
export {};
```

- [ ] **Step 4: Install + typecheck**

Run: `pnpm install && pnpm --filter @forex-bot/agents typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/agents pnpm-lock.yaml
git commit -m "feat(agents): scaffold package with shared deps"
```

---

## Task 5: `agents` — `RegimeNode` (rule + LLM hybrid)

**Files:**
- Create: `packages/agents/src/{regime.ts,prompts/regime.ts}`, `packages/agents/test/regime.test.ts`
- Modify: `packages/agents/src/index.ts`

The design spec frames RegimeNode as a "rule + Sonnet" hybrid. We start with a pure rule classifier (ATR, ADX, recent calendar intensity) for v1; LLM mode is a future extension.

- [ ] **Step 1: Write the failing test `packages/agents/test/regime.test.ts`**

```ts
import type { Candle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { classifyRegime } from "../src/regime.js";

function flat(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: i,
    open: 1,
    high: 1.001,
    low: 0.999,
    close: 1,
    volume: 0,
  }));
}

function trending(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: i,
    open: 1 + i * 0.001,
    high: 1 + i * 0.001 + 0.0008,
    low: 1 + i * 0.001,
    close: 1 + i * 0.001 + 0.0007,
    volume: 0,
  }));
}

describe("classifyRegime", () => {
  it("classifies a flat series as ranging / low-vol", () => {
    const r = classifyRegime({ candlesH1: flat(60), upcomingHighImpactCount: 0 });
    expect(r.label).toBe("ranging");
    expect(r.volBucket).toBe("low");
  });

  it("classifies a steady uptrend as trending", () => {
    const r = classifyRegime({ candlesH1: trending(60), upcomingHighImpactCount: 0 });
    expect(r.label).toBe("trending");
  });

  it("classifies dense calendar window as event-driven", () => {
    const r = classifyRegime({ candlesH1: flat(60), upcomingHighImpactCount: 3 });
    expect(r.label).toBe("event-driven");
  });
});
```

- [ ] **Step 2: Write `packages/agents/src/regime.ts`**

```ts
import type { Candle, Regime } from "@forex-bot/contracts";
import { adx, atr } from "@forex-bot/indicators";

export interface ClassifyRegimeInput {
  candlesH1: readonly Candle[];
  /** Count of high-impact events within the lookahead window. */
  upcomingHighImpactCount: number;
}

export function classifyRegime(input: ClassifyRegimeInput): Regime {
  const adxSeries = adx(input.candlesH1, 14);
  const atrSeries = atr(input.candlesH1, 14);
  const lastAdx = adxSeries.at(-1);
  const lastAtr = atrSeries.at(-1);
  const meanClose =
    input.candlesH1.reduce((s, c) => s + c.close, 0) / Math.max(input.candlesH1.length, 1);
  const atrPct = lastAtr !== undefined && meanClose !== 0 ? lastAtr / meanClose : 0;

  if (input.upcomingHighImpactCount >= 2) {
    return { label: "event-driven", volBucket: bucketize(atrPct) };
  }
  if (typeof lastAdx === "number" && lastAdx > 25) {
    return { label: "trending", volBucket: bucketize(atrPct) };
  }
  return { label: "ranging", volBucket: bucketize(atrPct) };
}

function bucketize(atrPct: number): Regime["volBucket"] {
  if (atrPct < 0.001) return "low";
  if (atrPct < 0.005) return "normal";
  if (atrPct < 0.012) return "high";
  return "extreme";
}
```

- [ ] **Step 3: Update index**

```ts
// src/index.ts
export * from "./regime.js";
```

- [ ] **Step 4: Run test (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add rule-based RegimeNode classifier"
```

---

## Task 6: `agents` — TA Analyst

**Files:**
- Create: `packages/agents/src/{ta-analyst.ts,prompts/ta.ts}`, `packages/agents/test/ta-analyst.test.ts`

- [ ] **Step 1: Write `packages/agents/src/prompts/ta.ts`**

```ts
export const TA_SYSTEM_PROMPT = `You are a senior technical analyst for FX/metals.
Given multi-timeframe candles + computed indicators, output a structured analyst opinion.

Rules:
- bias: "long" | "short" | "neutral".
- conviction in [0,1]; reflect both signal strength and risk-of-failure.
- evidence MUST cite indicator values you saw in input (e.g. "H1 ADX 32, EMA20 stacked above EMA50").
- reasoning: at most 4 sentences. No hedging language ("may"/"might") unless conviction < 0.4.
- Do NOT invent indicator values not present in input.
- If evidence is contradictory across timeframes, prefer H1/H4 confluence over D1.`;
```

- [ ] **Step 2: Write the failing test `packages/agents/test/ta-analyst.test.ts`**

```ts
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { taAnalyst } from "../src/ta-analyst.js";

const stubBundle = {
  symbol: "EURUSD" as const,
  ts: 1,
  trigger: { reason: "schedule" as const, timeframe: "H1" as const },
  market: {
    symbol: "EURUSD" as const,
    M15: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H1: [{ ts: 1, open: 1.08, high: 1.082, low: 1.078, close: 1.0815, volume: 0 }],
    H4: [{ ts: 1, open: 1.08, high: 1.085, low: 1.075, close: 1.083, volume: 0 }],
    D1: [{ ts: 1, open: 1.08, high: 1.09, low: 1.07, close: 1.085, volume: 0 }],
  },
  account: {
    ts: 1,
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    freeMargin: 10_000,
    usedMargin: 0,
    marginLevelPct: 0,
  },
  openPositions: [],
  recentNews: [],
  upcomingEvents: [],
  regimePrior: { label: "trending" as const, volBucket: "normal" as const },
};

describe("taAnalyst", () => {
  it("invokes the LLM with the TA system prompt and Sonnet 4.6", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "technical",
        bias: "long",
        conviction: 0.7,
        reasoning: "HH/HL on H1.",
        evidence: ["H1 close above 20EMA"],
      }),
    });
    const out = await taAnalyst({ bundle: stubBundle, llm });
    expect(out.source).toBe("technical");
    expect(out.bias).toBe("long");
    expect(llm.calls[0]?.model).toBe("claude-sonnet-4-6");
    expect(llm.calls[0]?.system).toContain("technical analyst");
  });

  it("returns a neutral output when LLM produces conviction = 0", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "technical",
        bias: "neutral",
        conviction: 0.0,
        reasoning: "no clear setup",
        evidence: [],
      }),
    });
    const out = await taAnalyst({ bundle: stubBundle, llm });
    expect(out.bias).toBe("neutral");
  });
});
```

- [ ] **Step 3: Write `packages/agents/src/ta-analyst.ts`**

```ts
import { type AnalystOutput, AnalystOutputSchema, type StateBundle } from "@forex-bot/contracts";
import { ema, rsi } from "@forex-bot/indicators";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { TA_SYSTEM_PROMPT } from "./prompts/ta.js";

export interface TaAnalystInput {
  bundle: StateBundle;
  llm: LlmProvider;
}

export async function taAnalyst({ bundle, llm }: TaAnalystInput): Promise<AnalystOutput> {
  const closesH1 = bundle.market.H1.map((c) => c.close);
  const ema20 = ema(closesH1, Math.min(20, closesH1.length));
  const rsi14 = rsi(closesH1, Math.min(14, closesH1.length - 1));
  const last = bundle.market.H1.at(-1);
  const userMessage = JSON.stringify(
    {
      symbol: bundle.symbol,
      regimePrior: bundle.regimePrior,
      lastH1: last,
      ema20Last: ema20.at(-1) ?? null,
      rsi14Last: rsi14.at(-1) ?? null,
      m15Last: bundle.market.M15.at(-1),
      h4Last: bundle.market.H4.at(-1),
      d1Last: bundle.market.D1.at(-1),
    },
    null,
    2,
  );
  return llm.structured({
    model: "claude-sonnet-4-6",
    system: TA_SYSTEM_PROMPT,
    user: userMessage,
    schema: AnalystOutputSchema,
  });
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./regime.js";
export * from "./ta-analyst.js";
```

- [ ] **Step 5: Run test (PASS)**

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add TA analyst (Sonnet 4.6 + AnalystOutputSchema)"
```

---

## Task 7: `agents` — Fundamental Analyst

**Files:**
- Create: `packages/agents/src/{fundamental-analyst.ts,prompts/fundamental.ts}`, `packages/agents/test/fundamental-analyst.test.ts`

> **Style:** Mirror Task 6 — system prompt in `prompts/fundamental.ts`, agent module assembles a JSON user message from `StateBundle.upcomingEvents` + a configurable rate-differential hint, calls Sonnet 4.6 with `AnalystOutputSchema`, source = `"fundamental"`. Test asserts model/system/source.

- [ ] **Step 1: Write `prompts/fundamental.ts`** — system prompt covering rate differentials, calendar-driven catalysts, COT positioning hints, with the same "evidence cites input" guardrail as TA.

- [ ] **Step 2: Write the failing test** — same fixture shape as TA, route returns `{ source: "fundamental", bias: "short", conviction: 0.6, reasoning: "...", evidence: [...] }`. Assert source + model.

- [ ] **Step 3: Write `fundamental-analyst.ts`** — assembles user message from `bundle.upcomingEvents` (next 48h, high-impact only), `bundle.account`, plus an optional `cotHint` field if available.

- [ ] **Step 4: Update index** — re-export `fundamentalAnalyst`.

- [ ] **Step 5: Run test (PASS).**

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Fundamental analyst"
```

---

## Task 8: `agents` — Sentiment Analyst

**Files:**
- Create: `packages/agents/src/{sentiment-analyst.ts,prompts/sentiment.ts}`, `packages/agents/test/sentiment-analyst.test.ts`

> **Style:** Same pattern. User message = recent headlines (last 24h, capped at top-20 by ts), CB-document RAG hits (top-3), optional CB speech snippets. System prompt focuses on hawkish/dovish shifts, narrative rotation, *not* social media. `source: "sentiment"`.

- [ ] **Step 1: Write `prompts/sentiment.ts`.**
- [ ] **Step 2: Write the failing test.**
- [ ] **Step 3: Write `sentiment-analyst.ts`.** Accept an optional `ragHits: readonly RagDoc[]` from `data-core` so callers can pre-retrieve.
- [ ] **Step 4: Update index.**
- [ ] **Step 5: Run test.**
- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Sentiment analyst with RAG-hit input"
```

---

## Task 9: `agents` — Aggregator (pure TS)

**Files:**
- Create: `packages/agents/src/aggregator.ts`, `packages/agents/test/aggregator.test.ts`

The Aggregator is non-LLM: it normalizes 3 `AnalystOutput`s into a signal vector and decides consensus.

- [ ] **Step 1: Write the failing test**

```ts
import type { AnalystOutput } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregator.js";

function a(source: AnalystOutput["source"], bias: AnalystOutput["bias"], conv: number): AnalystOutput {
  return { source, bias, conviction: conv, reasoning: "x", evidence: [] };
}

describe("aggregate", () => {
  it("declares consensus when all 3 agree above threshold", () => {
    const r = aggregate(
      [a("technical", "long", 0.8), a("fundamental", "long", 0.75), a("sentiment", "long", 0.7)],
      { consensusThreshold: 0.7 },
    );
    expect(r.consensus).toBe(true);
    expect(r.direction).toBe("long");
  });

  it("declares no consensus when one analyst dissents", () => {
    const r = aggregate(
      [a("technical", "long", 0.8), a("fundamental", "long", 0.75), a("sentiment", "short", 0.7)],
      { consensusThreshold: 0.7 },
    );
    expect(r.consensus).toBe(false);
  });

  it("declares no consensus when avg conviction < threshold even if directions agree", () => {
    const r = aggregate(
      [a("technical", "long", 0.4), a("fundamental", "long", 0.5), a("sentiment", "long", 0.5)],
      { consensusThreshold: 0.7 },
    );
    expect(r.consensus).toBe(false);
  });

  it("normalizes to a signed signal vector", () => {
    const r = aggregate(
      [a("technical", "long", 0.8), a("fundamental", "long", 0.6), a("sentiment", "neutral", 0.3)],
      { consensusThreshold: 0.7 },
    );
    expect(r.signal.technical).toBeCloseTo(0.8, 5);
    expect(r.signal.sentiment).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Write `packages/agents/src/aggregator.ts`**

```ts
import type { AnalystOutput, Bias } from "@forex-bot/contracts";

export interface AggregateOptions {
  consensusThreshold: number;
}

export interface AggregatedSignal {
  consensus: boolean;
  direction: Bias;
  /** Signed conviction per source: positive = long, negative = short, 0 = neutral. */
  signal: Record<AnalystOutput["source"], number>;
  meanConviction: number;
}

export function aggregate(
  outputs: readonly AnalystOutput[],
  opts: AggregateOptions,
): AggregatedSignal {
  const signal = {} as Record<AnalystOutput["source"], number>;
  for (const o of outputs) {
    const sign = o.bias === "long" ? 1 : o.bias === "short" ? -1 : 0;
    signal[o.source] = sign * o.conviction;
  }
  const directions = outputs.map((o) => o.bias);
  const allSame = directions.every((d) => d === directions[0]);
  const direction: Bias = allSame ? (directions[0] ?? "neutral") : "neutral";
  const meanConviction = outputs.reduce((s, o) => s + o.conviction, 0) / Math.max(outputs.length, 1);
  const consensus = allSame && direction !== "neutral" && meanConviction >= opts.consensusThreshold;
  return { consensus, direction, signal, meanConviction };
}
```

- [ ] **Step 3: Update index + run test.**

- [ ] **Step 4: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Aggregator + consensus rule"
```

---

## Task 10: `agents` — Bull/Bear debaters

**Files:**
- Create: `packages/agents/src/{debater.ts,prompts/{bull,bear}.ts}`, `packages/agents/test/debater.test.ts`

A debater takes the 3 analyst outputs + own-side mandate, returns `{arguments[], risks[], counters[]}` (a separate Zod schema, defined in this task).

- [ ] **Step 1: Write `prompts/bull.ts` and `prompts/bear.ts`.** Each system prompt: 3-paragraph mandate (long-side or short-side), explicit "argue your side" directive, 4-sentence ceiling per argument, no hedging.

- [ ] **Step 2: Define `DebaterOutputSchema` in `debater.ts`** (export from package; consider promoting to `@forex-bot/contracts` later). Schema: `{ side: "bull"|"bear", arguments: string[], risks: string[], counters: string[] }`.

- [ ] **Step 3: Write the failing test** — covers (a) Bull called with the bull prompt, (b) Bear called with the bear prompt, (c) Sonnet 4.6 model.

- [ ] **Step 4: Write `debater.ts`** — single function `debate(side, bundle, analysts, llm)` that picks the right system prompt and calls the LLM.

- [ ] **Step 5: Update index + run test.**

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Bull/Bear debaters with DebaterOutputSchema"
```

---

## Task 11: `agents` — Judge (Opus 4.7)

**Files:**
- Create: `packages/agents/src/{judge.ts,prompts/judge.ts}`, `packages/agents/test/judge.test.ts`

Judge takes the debate transcript + analyst outputs, produces a `Verdict` (already in `@forex-bot/contracts`).

- [ ] **Step 1: Write `prompts/judge.ts`.** System prompt: synthesize the debate, weigh arguments by evidence quality, call horizon explicitly, `debated: true`. Use `effort: "xhigh"`.

- [ ] **Step 2: Write the failing test** — assert model = `claude-opus-4-7`, effort = `xhigh`, schema = `VerdictSchema`.

- [ ] **Step 3: Write `judge.ts`.** Accepts `{ analysts, debate: { bull, bear }, bundle }`, outputs `Verdict`. Always sets `debated: true`.

- [ ] **Step 4: Update index + run test.**

- [ ] **Step 5: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Judge (Opus 4.7, xhigh effort)"
```

---

## Task 12: `agents` — Risk Officer LLM

**Files:**
- Create: `packages/agents/src/{risk-officer.ts,prompts/risk-officer.ts}`, `packages/agents/test/risk-officer.test.ts`

The Risk Officer LLM is a *reasoning* layer that runs **after** the 9 hard gates from Plan 1 produce a tentatively-approved `RiskDecision`. It can tighten size or veto entirely; it cannot loosen.

- [ ] **Step 1: Write `prompts/risk-officer.ts`** — explicit "you can tighten or veto, never loosen", references the 9-gate output, instructed to respond with the same `RiskDecisionSchema` shape.

- [ ] **Step 2: Write the failing test** — covers (a) keeps approval as-is when no concerns, (b) tightens lotSize, (c) vetoes with `vetoReason`. Assert model = `claude-opus-4-7`.

- [ ] **Step 3: Write `risk-officer.ts`** — input: `{ tentativeDecision: RiskDecision, verdict: Verdict, bundle: StateBundle }`. Output: `RiskDecision` (re-validated against schema). If tentative was `approve: false`, the Risk Officer LLM is skipped (gates already vetoed; no LLM tightening possible).

- [ ] **Step 4: Update index + run test.**

- [ ] **Step 5: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Risk Officer LLM (Opus 4.7, never-loosens invariant)"
```

---

## Task 13: `agents` — Reflection (post-trade)

**Files:**
- Create: `packages/agents/src/{reflection.ts,prompts/reflection.ts}`, `packages/agents/test/reflection.test.ts`

Reflection runs *after* a trade closes. It takes the original journal entry + outcome, retrieves similar past trades from RAG, and writes a lesson.

- [ ] **Step 1: Define `ReflectionOutputSchema`** = `{ lesson: string, tags: string[], confidence: number }`. Use Opus 4.7.

- [ ] **Step 2: Write `prompts/reflection.ts`** — instructs the model to be specific (cite the regime, the setup type, the indicator values), avoid generic platitudes ("trade with discipline"), flag errors candidly.

- [ ] **Step 3: Write the failing test** — covers happy path + uses `RagDoc[]` of similar past trades in the user message.

- [ ] **Step 4: Write `reflection.ts`** — returns `ReflectionOutput`; caller is responsible for embedding the `lesson` text and writing it to the RAG store via `data-core`.

- [ ] **Step 5: Update index + run test.**

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add Reflection agent with ReflectionOutputSchema"
```

---

## Task 14: `graph` — package scaffold + state types

**Files:**
- Create: `packages/graph/{package.json,tsconfig.json,src/{state.ts,index.ts}}`

- [ ] **Step 1: Write `packages/graph/package.json`**

```json
{
  "name": "@forex-bot/graph",
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
    "@forex-bot/agents": "workspace:*",
    "@forex-bot/contracts": "workspace:*",
    "@forex-bot/llm-provider": "workspace:*",
    "@forex-bot/risk": "workspace:*",
    "@langchain/langgraph": "^0.2.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.**

- [ ] **Step 3: Write `packages/graph/src/state.ts`**

```ts
import type {
  AnalystOutput,
  RiskDecision,
  StateBundle,
  Verdict,
} from "@forex-bot/contracts";
import type { GateContext } from "@forex-bot/risk";

export interface GraphState {
  bundle: StateBundle;
  /** Filled by Aggregator after parallel analyst fanout. */
  analysts?: readonly AnalystOutput[];
  /** Whether all 3 agreed above threshold. */
  consensus?: boolean;
  /** Optional debate transcript when consensus = false. */
  debate?: {
    bull: { arguments: readonly string[]; risks: readonly string[]; counters: readonly string[] };
    bear: { arguments: readonly string[]; risks: readonly string[]; counters: readonly string[] };
  };
  verdict?: Verdict;
  /** Output of the 9-gate evaluator from Plan 1 (pre-Risk-Officer). */
  tentativeDecision?: RiskDecision;
  /** Final decision after Risk Officer LLM. */
  finalDecision?: RiskDecision;
  /** Risk gate context the runner constructs from broker + cache. */
  gateContext: GateContext;
}
```

- [ ] **Step 4: Stub `index.ts`**

```ts
export * from "./state.js";
```

- [ ] **Step 5: Install + typecheck + commit.**

```bash
git add packages/graph pnpm-lock.yaml
git commit -m "feat(graph): scaffold package + GraphState type"
```

---

## Task 15: `graph` — node fanout (regime → analysts → aggregator)

**Files:**
- Create: `packages/graph/src/nodes.ts`, `packages/graph/test/nodes.test.ts`

- [ ] **Step 1: Write the failing test `packages/graph/test/nodes.test.ts`**

```ts
import type { StateBundle } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import {
  aggregatorNode,
  analystsNode,
  regimeNode,
  type GraphState,
} from "../src/index.js";

const stubBundle: StateBundle = {
  symbol: "EURUSD",
  ts: 1,
  trigger: { reason: "schedule", timeframe: "H1" },
  market: {
    symbol: "EURUSD",
    M15: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H1: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H4: [{ ts: 1, open: 1.08, high: 1.085, low: 1.075, close: 1.083, volume: 0 }],
    D1: [{ ts: 1, open: 1.08, high: 1.09, low: 1.07, close: 1.085, volume: 0 }],
  },
  account: {
    ts: 1, currency: "USD", balance: 10_000, equity: 10_000,
    freeMargin: 10_000, usedMargin: 0, marginLevelPct: 0,
  },
  openPositions: [],
  recentNews: [],
  upcomingEvents: [],
  regimePrior: { label: "trending", volBucket: "normal" },
};

describe("graph nodes", () => {
  it("regimeNode fills regimePrior from rule classifier", async () => {
    const state: GraphState = { bundle: stubBundle, gateContext: {} as any };
    const out = await regimeNode(state, { llm: new FakeLlm({ route: () => ({}) }) });
    expect(out.bundle.regimePrior).toBeDefined();
  });

  it("analystsNode fans out to 3 analysts in parallel", async () => {
    const llm = new FakeLlm({
      route: (req) => {
        const source = req.system.includes("technical")
          ? "technical"
          : req.system.includes("fundamental")
            ? "fundamental"
            : "sentiment";
        return { source, bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
      },
    });
    const state: GraphState = { bundle: stubBundle, gateContext: {} as any };
    const out = await analystsNode(state, { llm });
    expect(out.analysts).toHaveLength(3);
  });

  it("aggregatorNode declares consensus when all 3 agree above threshold", async () => {
    const state: GraphState = {
      bundle: stubBundle,
      gateContext: {} as any,
      analysts: [
        { source: "technical", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] },
        { source: "fundamental", bias: "long", conviction: 0.75, reasoning: "x", evidence: [] },
        { source: "sentiment", bias: "long", conviction: 0.7, reasoning: "x", evidence: [] },
      ],
    };
    const out = await aggregatorNode(state, { consensusThreshold: 0.7 });
    expect(out.consensus).toBe(true);
  });
});
```

- [ ] **Step 2: Write `packages/graph/src/nodes.ts`**

```ts
import {
  aggregate,
  classifyRegime,
  fundamentalAnalyst,
  sentimentAnalyst,
  taAnalyst,
} from "@forex-bot/agents";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GraphState } from "./state.js";

export interface NodeDeps {
  llm: LlmProvider;
}

export async function regimeNode(state: GraphState, _deps: NodeDeps): Promise<Partial<GraphState>> {
  const regime = classifyRegime({
    candlesH1: state.bundle.market.H1,
    upcomingHighImpactCount: state.bundle.upcomingEvents.filter((e) => e.impact === "high").length,
  });
  return { bundle: { ...state.bundle, regimePrior: regime } };
}

export async function analystsNode(state: GraphState, deps: NodeDeps): Promise<Partial<GraphState>> {
  const [ta, fundamental, sentiment] = await Promise.all([
    taAnalyst({ bundle: state.bundle, llm: deps.llm }),
    fundamentalAnalyst({ bundle: state.bundle, llm: deps.llm }),
    sentimentAnalyst({ bundle: state.bundle, llm: deps.llm }),
  ]);
  return { analysts: [ta, fundamental, sentiment] };
}

export interface AggregatorNodeDeps {
  consensusThreshold: number;
}

export async function aggregatorNode(
  state: GraphState,
  deps: AggregatorNodeDeps,
): Promise<Partial<GraphState>> {
  if (!state.analysts) throw new Error("aggregatorNode requires state.analysts");
  const out = aggregate(state.analysts, { consensusThreshold: deps.consensusThreshold });
  return { consensus: out.consensus };
}
```

- [ ] **Step 3: Update `index.ts`**

```ts
export * from "./nodes.js";
export * from "./state.js";
```

- [ ] **Step 4: Run test (PASS).**

- [ ] **Step 5: Commit**

```bash
git add packages/graph
git commit -m "feat(graph): add regime/analysts/aggregator nodes"
```

---

## Task 16: `graph` — debate branch + judge + risk officer + `buildGraph()`

**Files:**
- Create: `packages/graph/src/{debate-nodes.ts,risk-nodes.ts,build-graph.ts}`, `packages/graph/test/build-graph.test.ts`
- Modify: `packages/graph/src/index.ts`

This task wires the full StateGraph using LangGraph.js, with conditional routing based on `consensus`.

- [ ] **Step 1: Write `debate-nodes.ts`** — `bullNode`, `bearNode` (parallelizable via `Promise.all`), `judgeNode` consuming `state.debate`. `consensusJudgeNode` wraps the consensus path's verdict construction (no LLM — synthesize from the analysts).

- [ ] **Step 2: Write `risk-nodes.ts`** — `gatesNode` (calls `evaluate(gateContext)` from `@forex-bot/risk`), `riskOfficerNode` (calls the LLM only when `tentativeDecision.approve === true`).

- [ ] **Step 3: Write `build-graph.ts` using LangGraph.js**

```ts
import { END, START, StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { aggregatorNode, analystsNode, regimeNode } from "./nodes.js";
import { bearNode, bullNode, consensusJudgeNode, judgeNode } from "./debate-nodes.js";
import { gatesNode, riskOfficerNode } from "./risk-nodes.js";
import type { GraphState } from "./state.js";

const StateAnnotation = Annotation.Root({
  bundle: Annotation<GraphState["bundle"]>(),
  analysts: Annotation<GraphState["analysts"]>(),
  consensus: Annotation<GraphState["consensus"]>(),
  debate: Annotation<GraphState["debate"]>(),
  verdict: Annotation<GraphState["verdict"]>(),
  tentativeDecision: Annotation<GraphState["tentativeDecision"]>(),
  finalDecision: Annotation<GraphState["finalDecision"]>(),
  gateContext: Annotation<GraphState["gateContext"]>(),
});

export interface BuildGraphDeps {
  llm: import("@forex-bot/llm-provider").LlmProvider;
  consensusThreshold: number;
}

export function buildGraph(deps: BuildGraphDeps) {
  const g = new StateGraph(StateAnnotation)
    .addNode("regime", (s) => regimeNode(s as GraphState, deps))
    .addNode("analysts", (s) => analystsNode(s as GraphState, deps))
    .addNode("aggregator", (s) => aggregatorNode(s as GraphState, deps))
    .addNode("bull", (s) => bullNode(s as GraphState, deps))
    .addNode("bear", (s) => bearNode(s as GraphState, deps))
    .addNode("judge", (s) => judgeNode(s as GraphState, deps))
    .addNode("consensusJudge", (s) => consensusJudgeNode(s as GraphState))
    .addNode("gates", (s) => gatesNode(s as GraphState))
    .addNode("riskOfficer", (s) => riskOfficerNode(s as GraphState, deps))
    .addEdge(START, "regime")
    .addEdge("regime", "analysts")
    .addEdge("analysts", "aggregator")
    .addConditionalEdges("aggregator", (s) => (s.consensus ? "consensusJudge" : "bull"), {
      consensusJudge: "consensusJudge",
      bull: "bull",
    })
    .addEdge("bull", "bear")
    .addEdge("bear", "judge")
    .addEdge("judge", "gates")
    .addEdge("consensusJudge", "gates")
    .addConditionalEdges(
      "gates",
      (s) => (s.tentativeDecision?.approve ? "riskOfficer" : END),
      { riskOfficer: "riskOfficer", [END]: END },
    )
    .addEdge("riskOfficer", END);
  return g.compile();
}
```

- [ ] **Step 4: Write `packages/graph/test/build-graph.test.ts`** — three integration tests, all using `FakeLlm`:

```ts
// Pseudocode:
//
// 1. Consensus path: analysts all return long@0.8, judge skipped, gates pass, RO approves.
// 2. Debate path: analysts disagree, Bull/Bear/Judge fire, gates pass, RO approves.
// 3. Risk-veto path: analysts agree, but spread is too wide → gates veto → RO not invoked.
//
// Assert state.finalDecision shape + that the right LLM calls fired (via FakeLlm.calls).
```

(The full test code follows the pattern from Task 15's nodes test — long but mechanical. Lay out one route per `it` block and assert `state.finalDecision.approve`, the count of LLM calls, and the model used per call.)

- [ ] **Step 5: Update index.**

- [ ] **Step 6: Run test (PASS) + typecheck.**

- [ ] **Step 7: Commit**

```bash
git add packages/graph pnpm-lock.yaml
git commit -m "feat(graph): wire LangGraph StateGraph with consensus/debate/veto routing"
```

---

## Task 17: `telemetry` package

**Files:**
- Create: `packages/telemetry/{package.json,tsconfig.json,src/{logger.ts,langsmith.ts,index.ts},test/logger.test.ts}`

`logger.ts` is a small structured-JSON logger; `langsmith.ts` is an optional client wrapper that no-ops when `LANGCHAIN_API_KEY` isn't set.

- [ ] **Step 1: Write `package.json` (no deps beyond contracts) + tsconfig.**

- [ ] **Step 2: Write `logger.ts`** with `info` / `warn` / `error` emitting JSON to stdout/stderr + optional fields.

- [ ] **Step 3: Write `langsmith.ts`** — feature-detection only; if env var unset, returns a no-op tracer.

- [ ] **Step 4: Write `logger.test.ts`** — captures stdout, asserts JSON shape.

- [ ] **Step 5: Run + commit**

```bash
git add packages/telemetry pnpm-lock.yaml
git commit -m "feat(telemetry): structured logger + optional LangSmith no-op stub"
```

---

## Task 18: `agent-runner` — scaffold + `StateBundle` assembler

**Files:**
- Create: `apps/agent-runner/{package.json,tsconfig.json,src/{state-assembler.ts,index.ts},test/state-assembler.test.ts}`

The assembler composes a `StateBundle` from `Broker` (Plan 2) + `HotCache` (Plan 3).

- [ ] **Step 1: Write `package.json`** with workspace deps on broker-core, cache, contracts, data-core, indicators, agents, graph, llm-provider, risk, telemetry.

- [ ] **Step 2: Write the failing test** — uses `FakeBroker` from `@forex-bot/broker-core` + `InMemoryHotCache` from `@forex-bot/data-core`. Seeds quotes/candles/account/positions, calls `assembleState({broker, cache, symbol, ts, trigger})`, validates the resulting bundle against `StateBundleSchema`.

- [ ] **Step 3: Write `state-assembler.ts`** — fetches `getCandles(symbol, "M15"|"H1"|"H4"|"D1", 200)`, `getAccount`, `getOpenPositions`, then pulls headlines + calendar from cache. Defaults `regimePrior` to `{ label: "trending", volBucket: "normal" }` (RegimeNode overwrites it inside the graph).

- [ ] **Step 4: Run + commit.**

```bash
git add apps/agent-runner pnpm-lock.yaml
git commit -m "feat(agent-runner): scaffold + StateBundle assembler"
```

---

## Task 19: `agent-runner` — trigger detection

**Files:**
- Create: `apps/agent-runner/src/triggers.ts`, `apps/agent-runner/test/triggers.test.ts`

Pure-TS logic; no I/O.

- [ ] **Step 1: Write the failing test** — covers (a) M15/H1/H4/D1 close detection from a `nowMs` and a `lastTickedMs`, (b) S/R-break price event using indicators package's `clusterLevels`, (c) ATR-expansion event (current bar range > 2× ATR), (d) news event within ±W minutes of a high-impact event, (e) 30-min rebalance.

- [ ] **Step 2: Write `triggers.ts`** — exports `detectTriggers({ nowMs, lastTickedMs, candles, levels, upcomingEvents, lastRebalanceMs }): TickTrigger[]`.

- [ ] **Step 3: Run + commit**

```bash
git add apps/agent-runner
git commit -m "feat(agent-runner): add trigger detection (schedule/price/news/rebalance)"
```

---

## Task 20: `agent-runner` — `tick()` orchestration

**Files:**
- Create: `apps/agent-runner/src/tick.ts`, `apps/agent-runner/test/tick.test.ts`

`tick()` is the single entry point: input = trigger + deps; output = `RiskDecision` (or veto).

- [ ] **Step 1: Write the failing test** — wires `FakeLlm` + `FakeBroker` + `InMemoryHotCache` + `defaultRiskConfig` end-to-end, calls `tick(...)`, asserts the returned `finalDecision.approve` matches the FakeLlm scripted scenario (consensus → approve).

- [ ] **Step 2: Write `tick.ts`** — orchestration:
  1. `assembleState` → `StateBundle`
  2. Build `gateContext` from broker + risk config
  3. `buildGraph(deps).invoke({ bundle, gateContext })`
  4. Return `state.finalDecision ?? state.tentativeDecision`

- [ ] **Step 3: Run + commit**

```bash
git add apps/agent-runner
git commit -m "feat(agent-runner): add tick() orchestrating assembler + graph + executor"
```

---

## Task 21: `agent-runner` — end-to-end + executor wire-up

**Files:**
- Create: `apps/agent-runner/test/integration.test.ts`

This integration test runs three end-to-end flows with `FakeLlm` + `FakeBroker`:

1. **Consensus → approve → execute:** `tick()` returns `approve: true`, then we call `execute()` from `@forex-bot/executor`, then `broker.getOpenPositions()` shows the new position.
2. **Debate → approve → execute** (FakeLlm scripted to disagree, with Bull/Bear/Judge firing).
3. **Risk-veto:** `currentSpreadPips: 5, medianSpreadPips: 1` → `gates` rejects, `tick()` returns `approve: false`, no position opened.

- [ ] **Step 1: Write the test (long but mechanical).**
- [ ] **Step 2: Run.**
- [ ] **Step 3: Commit**

```bash
git add apps/agent-runner
git commit -m "test(agent-runner): end-to-end consensus + debate + veto flows"
```

---

## Task 22: `agent-runner` — Reflection trigger on close

**Files:**
- Create: `apps/agent-runner/src/reflect.ts`, `apps/agent-runner/test/reflect.test.ts`

A separate function called by the executor when a position closes. Composes original journal + outcome → calls `reflection` agent → calls `writeJournalWithRag` from `@forex-bot/memory`.

- [ ] **Step 1: Write the test** — mocks the journal store + RAG store + LLM, asserts the full chain.

- [ ] **Step 2: Write `reflect.ts`.**

- [ ] **Step 3: Run + commit**

```bash
git add apps/agent-runner
git commit -m "feat(agent-runner): add reflect() invoking Reflection on trade close"
```

---

## Task 23: `agent-runner` — `main.ts` (scheduler loop)

**Files:**
- Create: `apps/agent-runner/src/main.ts`

The runnable entry point. Wires real instances: `MT5Broker` (or env-configured) + `RedisHotCache` + `AnthropicLlm` + watches symbols on a 1-min poll, calls `detectTriggers()`, fires `tick()` on hits.

- [ ] **Step 1: Write `main.ts`.** Reads config from env (`MT5_HOST`, `REDIS_URL`, `ANTHROPIC_API_KEY`, watched-symbols list, risk profile). Logs every tick with the structured logger from Plan 4 telemetry.

- [ ] **Step 2: Manual smoke (optional)** — running `pnpm --filter @forex-bot/agent-runner start` should boot without crashing if env vars are missing (it should fail-fast with a clear error).

- [ ] **Step 3: Commit**

```bash
git add apps/agent-runner
git commit -m "feat(agent-runner): add main.ts entrypoint with poll loop"
```

---

## Task 24: CI — gate Anthropic calls in tests

**Files:**
- Modify: `.github/workflows/ci.yml`

Tests must never make real LLM calls. The grep here is a defense-in-depth guard.

- [ ] **Step 1: Add a CI step before `pnpm test`**

```yaml
      - name: Verify no real Anthropic calls in tests
        run: |
          if grep -RInE 'new\s+AnthropicLlm\b' --include='*.test.ts' .; then
            echo "ERROR: AnthropicLlm cannot be instantiated in tests — use FakeLlm." >&2
            exit 1
          fi
```

- [ ] **Step 2: Local verify.**

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: block tests from instantiating AnthropicLlm"
```

---

## Task 25: README + plan-status update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add `agent-graph`, `agent-runner` rows to the package table; flip Plan 4 to done.**

- [ ] **Step 2: Add a section "Running the agent locally"** with the env vars (`MT5_HOST`, `REDIS_URL`, `ANTHROPIC_API_KEY`) and a sample `pnpm --filter @forex-bot/agent-runner start` invocation.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for Plan 4"
```

---

## Done-Done Checklist

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm proto:gen` regenerates broker-mt5 stubs deterministically.
- [ ] `pnpm -r typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes (no real LLM calls — defended by CI grep in Task 24).
- [ ] Three end-to-end integration tests in `agent-runner` exercise consensus / debate / risk-veto.
- [ ] `AnthropicLlm` is referenced **only** in non-test code (`packages/llm-provider/src/anthropic-llm.ts`) and `apps/agent-runner/src/main.ts`.
- [ ] No package imports a sibling package except via `@forex-bot/<name>`.
- [ ] No production code uses `any`, `as unknown as`, or hardcoded model IDs other than `claude-sonnet-4-6` / `claude-opus-4-7`.

## Deferred to future plans

- **Compaction / context editing.** Long-running graphs would benefit but the per-tick cycle is short enough that we don't need either yet.
- **Tool use within agents.** Analysts could call e.g. a price-history tool instead of receiving pre-baked candles; deferring until prompts are stable.
- **Streaming.** The structured-output requirement makes streaming awkward; we'll revisit when latency budgets get tight.
- **CloudWatch + SNS alerts.** The `telemetry` package wires LangSmith + structured logs; CW/SNS are Plan 6.
- **Multi-symbol parallelism.** `main.ts` ticks symbols sequentially; concurrency lands in Plan 6 with infra.
- **Risk Officer LLM "tighten" semantics audit.** The schema allows tighter sizes but the never-loosen invariant is enforced by the prompt today, not by code; an enforcement layer can land in Plan 5 or Plan 7.
- **Reflection-driven prompt iteration.** Once reflections accumulate, we can feed them back into analyst prompts. Out of scope for v1.
