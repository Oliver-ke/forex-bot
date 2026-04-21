# Forex Bot — Plan 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the fx-core monorepo with the pure packages the rest of the system will depend on — contracts (Zod schemas), indicators (TA math), risk engine (9-gate evaluation + kill-switch + sizing + correlation) — behind a green CI pipeline.

**Architecture:** pnpm workspaces monorepo. TypeScript strict mode. Vitest for tests. Biome for lint/format. Zod for runtime validation. No external I/O in any package shipped here — everything is pure so downstream packages (MT5 adapter, agents, executor) can unit-test against deterministic fakes. CI runs typecheck + lint + unit/property tests on every push.

**Tech Stack:** Node 20+, pnpm 9+, TypeScript 5.5+, Vitest 2.x, Zod 3.23+, Biome 1.9+, fast-check (for property tests), GitHub Actions.

---

## File structure produced by this plan

```
forex-bot/
├── .github/workflows/ci.yml
├── .gitignore
├── .nvmrc
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── prd/                            # already exists (design spec + plans)
└── packages/
    ├── contracts/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── primitives.ts
    │   │   ├── market.ts
    │   │   ├── account.ts
    │   │   ├── analysis.ts
    │   │   ├── journal.ts
    │   │   ├── state.ts
    │   │   ├── risk-config.ts
    │   │   └── index.ts
    │   └── test/*.test.ts
    ├── indicators/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── types.ts
    │   │   ├── sma.ts
    │   │   ├── ema.ts
    │   │   ├── rsi.ts
    │   │   ├── atr.ts
    │   │   ├── adx.ts
    │   │   ├── bollinger.ts
    │   │   ├── swings.ts
    │   │   ├── support-resistance.ts
    │   │   └── index.ts
    │   └── test/*.test.ts
    └── risk/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── kill-switch.ts
        │   ├── sizing.ts
        │   ├── correlation.ts
        │   ├── gates/
        │   │   ├── kill-switch.ts
        │   │   ├── spread.ts
        │   │   ├── session.ts
        │   │   ├── news-blackout.ts
        │   │   ├── correlation.ts
        │   │   ├── currency-exposure.ts
        │   │   ├── concurrent.ts
        │   │   ├── per-trade-risk.ts
        │   │   ├── margin.ts
        │   │   └── types.ts
        │   ├── evaluate.ts
        │   └── index.ts
        └── test/*.test.ts
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`

- [ ] **Step 1: Write `.nvmrc`**

```
20
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
coverage/
.DS_Store
*.log
.env
.env.local
.vitest-cache/
```

- [ ] **Step 3: Write `package.json` at repo root**

```json
{
  "name": "forex-bot",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20.11" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0",
    "fast-check": "^3.22.0",
    "@vitest/coverage-v8": "^2.1.0"
  }
}
```

- [ ] **Step 4: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 5: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 6: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "useNodejsImportProtocol": "error" },
      "correctness": { "noUnusedImports": "error" }
    }
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 }
}
```

- [ ] **Step 7: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
```

- [ ] **Step 8: Install deps and verify**

Run: `pnpm install`
Expected: install succeeds, no errors.

Run: `pnpm typecheck`
Expected: fails cleanly (no packages yet) OR no-op. Not an error.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json vitest.config.ts .gitignore .nvmrc pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo with TS, Vitest, Biome"
```

---

## Task 2: `contracts` package — primitives

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/primitives.ts`, `packages/contracts/test/primitives.test.ts`, `packages/contracts/src/index.ts`

- [ ] **Step 1: Write `packages/contracts/package.json`**

```json
{
  "name": "@forex-bot/contracts",
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
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Write `packages/contracts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "compilerOptions": { "rootDir": "." }
}
```

- [ ] **Step 3: Write the failing test `packages/contracts/test/primitives.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  CurrencySchema,
  PipsSchema,
  PriceSchema,
  SymbolSchema,
  LotSizeSchema,
} from "../src/primitives.js";

describe("primitives", () => {
  it("Symbol accepts known FX/metal symbols", () => {
    expect(SymbolSchema.parse("EURUSD")).toBe("EURUSD");
    expect(SymbolSchema.parse("XAUUSD")).toBe("XAUUSD");
    expect(() => SymbolSchema.parse("eurusd")).toThrow();
    expect(() => SymbolSchema.parse("EUR/USD")).toThrow();
  });

  it("Currency accepts ISO codes", () => {
    expect(CurrencySchema.parse("USD")).toBe("USD");
    expect(() => CurrencySchema.parse("usd")).toThrow();
    expect(() => CurrencySchema.parse("US")).toThrow();
  });

  it("Price is a positive finite number", () => {
    expect(PriceSchema.parse(1.0845)).toBe(1.0845);
    expect(() => PriceSchema.parse(0)).toThrow();
    expect(() => PriceSchema.parse(-1)).toThrow();
    expect(() => PriceSchema.parse(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("Pips is a non-negative number", () => {
    expect(PipsSchema.parse(0)).toBe(0);
    expect(PipsSchema.parse(15.5)).toBe(15.5);
    expect(() => PipsSchema.parse(-0.1)).toThrow();
  });

  it("LotSize is between 0.01 and 100 in 0.01 steps", () => {
    expect(LotSizeSchema.parse(0.01)).toBe(0.01);
    expect(LotSizeSchema.parse(2)).toBe(2);
    expect(() => LotSizeSchema.parse(0)).toThrow();
    expect(() => LotSizeSchema.parse(101)).toThrow();
    expect(() => LotSizeSchema.parse(0.005)).toThrow();
  });
});
```

- [ ] **Step 4: Run test to confirm it fails**

Run: `pnpm vitest run packages/contracts/test/primitives.test.ts`
Expected: FAIL — cannot resolve `../src/primitives.js`.

- [ ] **Step 5: Write `packages/contracts/src/primitives.ts`**

```ts
import { z } from "zod";

export const SymbolSchema = z
  .string()
  .regex(/^[A-Z]{6}$/, "Symbol must be 6 uppercase letters (e.g. EURUSD, XAUUSD)");
export type Symbol = z.infer<typeof SymbolSchema>;

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 three-letter code");
export type Currency = z.infer<typeof CurrencySchema>;

export const PriceSchema = z.number().finite().positive();
export type Price = z.infer<typeof PriceSchema>;

export const PipsSchema = z.number().finite().nonnegative();
export type Pips = z.infer<typeof PipsSchema>;

export const LotSizeSchema = z
  .number()
  .finite()
  .min(0.01)
  .max(100)
  .refine((n) => Math.round(n * 100) === n * 100, "LotSize must be in 0.01 increments");
export type LotSize = z.infer<typeof LotSizeSchema>;

export const SideSchema = z.enum(["buy", "sell"]);
export type Side = z.infer<typeof SideSchema>;

export const TimeframeSchema = z.enum(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]);
export type Timeframe = z.infer<typeof TimeframeSchema>;
```

- [ ] **Step 6: Write `packages/contracts/src/index.ts`**

```ts
export * from "./primitives.js";
```

- [ ] **Step 7: Run test to confirm it passes**

Run: `pnpm vitest run packages/contracts/test/primitives.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add Zod primitives — Symbol, Currency, Price, Pips, LotSize, Side, Timeframe"
```

---

## Task 3: `contracts` — market data types

**Files:**
- Create: `packages/contracts/src/market.ts`, `packages/contracts/test/market.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/contracts/test/market.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { CandleSchema, TickSchema, MTFBundleSchema } from "../src/market.js";

describe("market types", () => {
  it("Candle requires OHLCV with high >= low and open/close within range", () => {
    const c = CandleSchema.parse({
      ts: 1710000000000,
      open: 1.08,
      high: 1.09,
      low: 1.07,
      close: 1.085,
      volume: 1000,
    });
    expect(c.close).toBe(1.085);
    expect(() =>
      CandleSchema.parse({ ts: 1, open: 1, high: 0.5, low: 1, close: 1, volume: 0 }),
    ).toThrow();
  });

  it("Tick requires bid <= ask", () => {
    expect(() =>
      TickSchema.parse({ ts: 1, symbol: "EURUSD", bid: 1.09, ask: 1.08 }),
    ).toThrow();
  });

  it("MTFBundle requires at least M15 and H1 arrays", () => {
    const c = { ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
    const b = MTFBundleSchema.parse({
      symbol: "EURUSD",
      M15: [c],
      H1: [c],
      H4: [c],
      D1: [c],
    });
    expect(b.M15).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm vitest run packages/contracts/test/market.test.ts`
Expected: FAIL — cannot resolve market.

- [ ] **Step 3: Write `packages/contracts/src/market.ts`**

```ts
import { z } from "zod";
import { PriceSchema, SymbolSchema } from "./primitives.js";

export const CandleSchema = z
  .object({
    ts: z.number().int().nonnegative(),
    open: PriceSchema,
    high: PriceSchema,
    low: PriceSchema,
    close: PriceSchema,
    volume: z.number().nonnegative(),
  })
  .refine((c) => c.high >= c.low, "high must be >= low")
  .refine((c) => c.open >= c.low && c.open <= c.high, "open must be within [low, high]")
  .refine((c) => c.close >= c.low && c.close <= c.high, "close must be within [low, high]");
export type Candle = z.infer<typeof CandleSchema>;

export const TickSchema = z
  .object({
    ts: z.number().int().nonnegative(),
    symbol: SymbolSchema,
    bid: PriceSchema,
    ask: PriceSchema,
  })
  .refine((t) => t.ask >= t.bid, "ask must be >= bid");
export type Tick = z.infer<typeof TickSchema>;

export const MTFBundleSchema = z.object({
  symbol: SymbolSchema,
  M15: z.array(CandleSchema).min(1),
  H1: z.array(CandleSchema).min(1),
  H4: z.array(CandleSchema).min(1),
  D1: z.array(CandleSchema).min(1),
});
export type MTFBundle = z.infer<typeof MTFBundleSchema>;
```

- [ ] **Step 4: Update `packages/contracts/src/index.ts`**

```ts
export * from "./primitives.js";
export * from "./market.js";
```

- [ ] **Step 5: Run test to confirm it passes**

Run: `pnpm vitest run packages/contracts/test/market.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add market types — Candle, Tick, MTFBundle"
```

---

## Task 4: `contracts` — account, positions, orders

**Files:**
- Create: `packages/contracts/src/account.ts`, `packages/contracts/test/account.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/contracts/test/account.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  AccountStateSchema,
  PositionSchema,
  PendingOrderSchema,
} from "../src/account.js";

describe("account types", () => {
  it("AccountState requires equity > 0 and balance >= 0", () => {
    const a = AccountStateSchema.parse({
      ts: 1,
      currency: "USD",
      balance: 10000,
      equity: 10050,
      freeMargin: 9500,
      usedMargin: 500,
      marginLevelPct: 2010,
    });
    expect(a.equity).toBe(10050);
    expect(() =>
      AccountStateSchema.parse({
        ts: 1,
        currency: "USD",
        balance: 0,
        equity: 0,
        freeMargin: 0,
        usedMargin: 0,
        marginLevelPct: 0,
      }),
    ).toThrow();
  });

  it("Position requires SL and TP on correct sides of entry", () => {
    const base = {
      id: "p-1",
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.5,
      entry: 1.08,
      openedAt: 1,
    } as const;
    expect(PositionSchema.parse({ ...base, sl: 1.07, tp: 1.09 }).side).toBe("buy");
    expect(() => PositionSchema.parse({ ...base, sl: 1.09, tp: 1.07 })).toThrow();
  });

  it("PendingOrder requires expiry >= now", () => {
    expect(() =>
      PendingOrderSchema.parse({
        symbol: "EURUSD",
        side: "buy",
        lotSize: 0.1,
        entry: 1.08,
        sl: 1.07,
        tp: 1.09,
        expiresAt: 0,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/contracts/test/account.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/contracts/src/account.ts`**

```ts
import { z } from "zod";
import { CurrencySchema, LotSizeSchema, PriceSchema, SideSchema, SymbolSchema } from "./primitives.js";

export const AccountStateSchema = z.object({
  ts: z.number().int().nonnegative(),
  currency: CurrencySchema,
  balance: z.number().finite().nonnegative(),
  equity: z.number().finite().positive(),
  freeMargin: z.number().finite().nonnegative(),
  usedMargin: z.number().finite().nonnegative(),
  marginLevelPct: z.number().finite().nonnegative(),
});
export type AccountState = z.infer<typeof AccountStateSchema>;

export const PositionSchema = z
  .object({
    id: z.string().min(1),
    symbol: SymbolSchema,
    side: SideSchema,
    lotSize: LotSizeSchema,
    entry: PriceSchema,
    sl: PriceSchema,
    tp: PriceSchema,
    openedAt: z.number().int().nonnegative(),
  })
  .refine(
    (p) => (p.side === "buy" ? p.sl < p.entry && p.tp > p.entry : p.sl > p.entry && p.tp < p.entry),
    "SL/TP must be on correct sides of entry for the chosen side",
  );
export type Position = z.infer<typeof PositionSchema>;

export const PendingOrderSchema = z.object({
  symbol: SymbolSchema,
  side: SideSchema,
  lotSize: LotSizeSchema,
  entry: PriceSchema,
  sl: PriceSchema,
  tp: PriceSchema,
  expiresAt: z.number().int().nonnegative(),
});
export type PendingOrder = z.infer<typeof PendingOrderSchema>;
```

- [ ] **Step 4: Update `packages/contracts/src/index.ts`**

```ts
export * from "./primitives.js";
export * from "./market.js";
export * from "./account.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/contracts/test/account.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add AccountState, Position, PendingOrder"
```

---

## Task 5: `contracts` — analysis, regime, verdict

**Files:**
- Create: `packages/contracts/src/analysis.ts`, `packages/contracts/test/analysis.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/contracts/test/analysis.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  AnalystOutputSchema,
  RegimeSchema,
  VerdictSchema,
} from "../src/analysis.js";

describe("analysis types", () => {
  it("Regime requires known label + vol bucket", () => {
    expect(RegimeSchema.parse({ label: "trending", volBucket: "normal" }).label).toBe("trending");
    expect(() => RegimeSchema.parse({ label: "sideways", volBucket: "normal" })).toThrow();
  });

  it("AnalystOutput conviction is in [0, 1]", () => {
    const ok = AnalystOutputSchema.parse({
      source: "technical",
      bias: "long",
      conviction: 0.75,
      reasoning: "HH/HL structure on H1",
      evidence: ["close above 20EMA"],
    });
    expect(ok.bias).toBe("long");
    expect(() =>
      AnalystOutputSchema.parse({
        source: "technical",
        bias: "long",
        conviction: 1.1,
        reasoning: "x",
        evidence: [],
      }),
    ).toThrow();
  });

  it("Verdict requires matching direction + confidence in [0,1]", () => {
    const v = VerdictSchema.parse({
      direction: "long",
      confidence: 0.8,
      horizon: "H4",
      reasoning: "confluence",
    });
    expect(v.direction).toBe("long");
    expect(() => VerdictSchema.parse({ direction: "neutral", confidence: 0.8, horizon: "H4", reasoning: "x" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/contracts/test/analysis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/contracts/src/analysis.ts`**

```ts
import { z } from "zod";
import { TimeframeSchema } from "./primitives.js";

export const RegimeLabelSchema = z.enum(["trending", "ranging", "event-driven", "risk-off"]);
export const VolBucketSchema = z.enum(["low", "normal", "high", "extreme"]);

export const RegimeSchema = z.object({
  label: RegimeLabelSchema,
  volBucket: VolBucketSchema,
});
export type Regime = z.infer<typeof RegimeSchema>;

export const BiasSchema = z.enum(["long", "short", "neutral"]);

export const AnalystSourceSchema = z.enum(["technical", "fundamental", "sentiment"]);

export const AnalystOutputSchema = z.object({
  source: AnalystSourceSchema,
  bias: BiasSchema,
  conviction: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  evidence: z.array(z.string()),
  data: z.record(z.unknown()).optional(),
});
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

export const VerdictSchema = z.object({
  direction: BiasSchema,
  confidence: z.number().min(0).max(1),
  horizon: TimeframeSchema,
  reasoning: z.string().min(1),
  debated: z.boolean().optional(),
});
export type Verdict = z.infer<typeof VerdictSchema>;
```

- [ ] **Step 4: Update index**

```ts
export * from "./primitives.js";
export * from "./market.js";
export * from "./account.js";
export * from "./analysis.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/contracts/test/analysis.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add Regime, AnalystOutput, Verdict"
```

---

## Task 6: `contracts` — risk config, risk decision

**Files:**
- Create: `packages/contracts/src/risk-config.ts`, `packages/contracts/test/risk-config.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/contracts/test/risk-config.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  RiskConfigSchema,
  RiskDecisionSchema,
  defaultRiskConfig,
} from "../src/risk-config.js";

describe("risk-config", () => {
  it("parses the default config", () => {
    const c = RiskConfigSchema.parse(defaultRiskConfig);
    expect(c.perTrade.riskPct).toBe(1.0);
    expect(c.killSwitch.action).toBe("close_all_and_halt");
  });

  it("rejects riskPct > 5 (sanity cap)", () => {
    expect(() =>
      RiskConfigSchema.parse({
        ...defaultRiskConfig,
        perTrade: { ...defaultRiskConfig.perTrade, riskPct: 6 },
      }),
    ).toThrow();
  });

  it("RiskDecision requires vetoReason when approve=false", () => {
    expect(() =>
      RiskDecisionSchema.parse({ approve: false }),
    ).toThrow();
    const d = RiskDecisionSchema.parse({ approve: false, vetoReason: "spread too wide" });
    expect(d.approve).toBe(false);
  });

  it("RiskDecision requires lotSize + SL + TP when approve=true", () => {
    const d = RiskDecisionSchema.parse({
      approve: true,
      lotSize: 0.1,
      sl: 1.07,
      tp: 1.09,
      expiresAt: 2,
      reasons: ["confluence + low spread"],
    });
    expect(d.approve).toBe(true);
    expect(() => RiskDecisionSchema.parse({ approve: true })).toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/contracts/test/risk-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/contracts/src/risk-config.ts`**

```ts
import { z } from "zod";
import { LotSizeSchema, PriceSchema, SymbolSchema } from "./primitives.js";

export const RiskProfileSchema = z.enum(["conservative", "standard", "prop_challenge"]);

export const RiskConfigSchema = z.object({
  account: z.object({
    profile: RiskProfileSchema,
    maxDailyLossPct: z.number().positive().max(20),
    maxTotalDrawdownPct: z.number().positive().max(50),
    maxConsecutiveLosses: z.number().int().positive().max(20),
    maxConcurrentPositions: z.number().int().positive().max(20),
    maxExposurePerCurrencyPct: z.number().positive().max(50),
  }),
  perTrade: z.object({
    riskPct: z.number().positive().max(5),
    minRR: z.number().positive().max(10),
    maxLotSize: LotSizeSchema,
  }),
  execution: z.object({
    maxSpreadMultiplier: z.number().positive().max(10),
    minStopDistanceAtr: z.number().positive().max(10),
    slippageTolerancePips: z.number().nonnegative().max(50),
  }),
  newsBlackout: z.object({
    highImpactWindowMin: z.number().int().nonnegative().max(120),
    postReleaseCalmMin: z.number().int().nonnegative().max(60),
  }),
  sessions: z.object({
    asia: z.object({ allowed: z.union([z.array(SymbolSchema), z.literal("all")]) }),
    london: z.object({ allowed: z.union([z.array(SymbolSchema), z.literal("all")]) }),
    ny: z.object({ allowed: z.union([z.array(SymbolSchema), z.literal("all")]) }),
    overlapNyLondon: z.object({ sizeMultiplier: z.number().positive().max(2) }),
  }),
  correlation: z.object({
    matrixRefreshDays: z.number().int().positive().max(90),
    maxNetCorrelatedExposurePct: z.number().positive().max(50),
  }),
  agent: z.object({
    consensusThreshold: z.number().min(0).max(1),
    debateMaxRounds: z.number().int().nonnegative().max(6),
    llmTimeoutMs: z.number().int().positive().max(120_000),
    llmRetryCount: z.number().int().nonnegative().max(5),
  }),
  killSwitch: z.object({
    feedStaleSec: z.number().int().positive().max(600),
    unhandledErrorRatePerHour: z.number().int().positive().max(100),
    action: z.enum(["close_all_and_halt", "halt_new_only"]),
  }),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const defaultRiskConfig: RiskConfig = {
  account: {
    profile: "standard",
    maxDailyLossPct: 3.0,
    maxTotalDrawdownPct: 8.0,
    maxConsecutiveLosses: 4,
    maxConcurrentPositions: 4,
    maxExposurePerCurrencyPct: 6.0,
  },
  perTrade: { riskPct: 1.0, minRR: 1.5, maxLotSize: 2.0 },
  execution: { maxSpreadMultiplier: 2.0, minStopDistanceAtr: 0.5, slippageTolerancePips: 2 },
  newsBlackout: { highImpactWindowMin: 10, postReleaseCalmMin: 5 },
  sessions: {
    asia: { allowed: ["USDJPY", "AUDUSD", "NZDUSD", "XAUUSD"] },
    london: { allowed: "all" },
    ny: { allowed: "all" },
    overlapNyLondon: { sizeMultiplier: 1.2 },
  },
  correlation: { matrixRefreshDays: 7, maxNetCorrelatedExposurePct: 4.0 },
  agent: { consensusThreshold: 0.7, debateMaxRounds: 2, llmTimeoutMs: 30_000, llmRetryCount: 1 },
  killSwitch: { feedStaleSec: 30, unhandledErrorRatePerHour: 5, action: "close_all_and_halt" },
};

export const RiskDecisionSchema = z.discriminatedUnion("approve", [
  z.object({
    approve: z.literal(true),
    lotSize: LotSizeSchema,
    sl: PriceSchema,
    tp: PriceSchema,
    expiresAt: z.number().int().nonnegative(),
    reasons: z.array(z.string()).min(1),
  }),
  z.object({
    approve: z.literal(false),
    vetoReason: z.string().min(1),
  }),
]);
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
```

- [ ] **Step 4: Update index**

```ts
export * from "./primitives.js";
export * from "./market.js";
export * from "./account.js";
export * from "./analysis.js";
export * from "./risk-config.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/contracts/test/risk-config.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add RiskConfig, RiskDecision, default config"
```

---

## Task 7: `contracts` — journal + state bundle

**Files:**
- Create: `packages/contracts/src/journal.ts`, `packages/contracts/src/state.ts`, `packages/contracts/test/state.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/contracts/test/state.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { StateBundleSchema } from "../src/state.js";
import { TradeJournalSchema } from "../src/journal.js";

describe("journal + state bundle", () => {
  it("TradeJournal round-trips with minimal fields", () => {
    const j = TradeJournalSchema.parse({
      tradeId: "t-1",
      symbol: "EURUSD",
      openedAt: 1,
      verdict: { direction: "long", confidence: 0.8, horizon: "H1", reasoning: "x" },
      risk: {
        approve: true,
        lotSize: 0.1,
        sl: 1.07,
        tp: 1.09,
        expiresAt: 2,
        reasons: ["ok"],
      },
    });
    expect(j.tradeId).toBe("t-1");
  });

  it("StateBundle composes MTF market + analyst context", () => {
    const c = { ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
    const s = StateBundleSchema.parse({
      symbol: "EURUSD",
      ts: 1,
      trigger: { reason: "schedule", timeframe: "H1" },
      market: { symbol: "EURUSD", M15: [c], H1: [c], H4: [c], D1: [c] },
      account: {
        ts: 1, currency: "USD", balance: 10000, equity: 10000, freeMargin: 10000,
        usedMargin: 0, marginLevelPct: 10000,
      },
      openPositions: [],
      recentNews: [],
      upcomingEvents: [],
      regimePrior: { label: "trending", volBucket: "normal" },
    });
    expect(s.symbol).toBe("EURUSD");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/contracts/test/state.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `packages/contracts/src/journal.ts`**

```ts
import { z } from "zod";
import { SymbolSchema } from "./primitives.js";
import { VerdictSchema, AnalystOutputSchema } from "./analysis.js";
import { RiskDecisionSchema } from "./risk-config.js";

export const TradeOutcomeSchema = z.object({
  closedAt: z.number().int().nonnegative(),
  pnl: z.number(),
  realizedR: z.number(),
  mae: z.number().nonnegative(),
  mfe: z.number().nonnegative(),
  exitReason: z.enum(["tp", "sl", "manual", "expiry", "kill_switch"]),
});
export type TradeOutcome = z.infer<typeof TradeOutcomeSchema>;

export const TradeJournalSchema = z.object({
  tradeId: z.string().min(1),
  symbol: SymbolSchema,
  openedAt: z.number().int().nonnegative(),
  analysts: z.array(AnalystOutputSchema).optional(),
  verdict: VerdictSchema,
  risk: RiskDecisionSchema,
  outcome: TradeOutcomeSchema.optional(),
});
export type TradeJournal = z.infer<typeof TradeJournalSchema>;
```

- [ ] **Step 4: Write `packages/contracts/src/state.ts`**

```ts
import { z } from "zod";
import { SymbolSchema, TimeframeSchema } from "./primitives.js";
import { MTFBundleSchema } from "./market.js";
import { AccountStateSchema, PositionSchema } from "./account.js";
import { RegimeSchema } from "./analysis.js";

export const NewsHeadlineSchema = z.object({
  ts: z.number().int().nonnegative(),
  source: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  symbolsMentioned: z.array(SymbolSchema).optional(),
});
export type NewsHeadline = z.infer<typeof NewsHeadlineSchema>;

export const CalendarEventSchema = z.object({
  ts: z.number().int().nonnegative(),
  currency: z.string().length(3),
  impact: z.enum(["low", "medium", "high"]),
  title: z.string().min(1),
  actual: z.number().optional(),
  forecast: z.number().optional(),
  previous: z.number().optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const TickTriggerSchema = z.object({
  reason: z.enum(["schedule", "price_event", "news_event", "rebalance"]),
  timeframe: TimeframeSchema.optional(),
  detail: z.string().optional(),
});

export const StateBundleSchema = z.object({
  symbol: SymbolSchema,
  ts: z.number().int().nonnegative(),
  trigger: TickTriggerSchema,
  market: MTFBundleSchema,
  account: AccountStateSchema,
  openPositions: z.array(PositionSchema),
  recentNews: z.array(NewsHeadlineSchema),
  upcomingEvents: z.array(CalendarEventSchema),
  regimePrior: RegimeSchema,
});
export type StateBundle = z.infer<typeof StateBundleSchema>;
```

- [ ] **Step 5: Update index**

```ts
export * from "./primitives.js";
export * from "./market.js";
export * from "./account.js";
export * from "./analysis.js";
export * from "./risk-config.js";
export * from "./journal.js";
export * from "./state.js";
```

- [ ] **Step 6: Run test**

Run: `pnpm vitest run packages/contracts/test/state.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck whole repo**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add TradeJournal, StateBundle, NewsHeadline, CalendarEvent"
```

---

## Task 8: `indicators` scaffold + SMA

**Files:**
- Create: `packages/indicators/package.json`, `packages/indicators/tsconfig.json`, `packages/indicators/src/types.ts`, `packages/indicators/src/sma.ts`, `packages/indicators/src/index.ts`, `packages/indicators/test/sma.test.ts`

- [ ] **Step 1: Write `packages/indicators/package.json`**

```json
{
  "name": "@forex-bot/indicators",
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
    "@forex-bot/contracts": "workspace:*"
  }
}
```

- [ ] **Step 2: Write `packages/indicators/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "compilerOptions": { "rootDir": "." }
}
```

- [ ] **Step 3: Write failing test `packages/indicators/test/sma.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { sma } from "../src/sma.js";

describe("sma", () => {
  it("returns undefined for indices before the window is full", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([undefined, undefined, 2, 3, 4]);
  });

  it("throws on period < 1 or period > input length", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
    expect(() => sma([1, 2], 3)).toThrow();
  });

  it("handles flat series", () => {
    expect(sma([5, 5, 5, 5], 2)).toEqual([undefined, 5, 5, 5]);
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/indicators/test/sma.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `packages/indicators/src/types.ts`**

```ts
export type Series = readonly number[];
export type MaybeSeries = readonly (number | undefined)[];
```

- [ ] **Step 6: Write `packages/indicators/src/sma.ts`**

```ts
import type { MaybeSeries, Series } from "./types.js";

export function sma(values: Series, period: number): MaybeSeries {
  if (period < 1) throw new Error("SMA period must be >= 1");
  if (period > values.length) throw new Error("SMA period must be <= input length");
  const out: (number | undefined)[] = new Array(values.length);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i] as number;
    if (i >= period) windowSum -= values[i - period] as number;
    out[i] = i >= period - 1 ? windowSum / period : undefined;
  }
  return out;
}
```

- [ ] **Step 7: Write `packages/indicators/src/index.ts`**

```ts
export * from "./types.js";
export * from "./sma.js";
```

- [ ] **Step 8: Run test**

Run: `pnpm vitest run packages/indicators/test/sma.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add SMA with window sliding and guard-rail validation"
```

---

## Task 9: `indicators` — EMA

**Files:**
- Create: `packages/indicators/src/ema.ts`, `packages/indicators/test/ema.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/indicators/test/ema.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ema } from "../src/ema.js";

describe("ema", () => {
  it("first (period-1) values are undefined; first emitted equals SMA seed", () => {
    // period=3 on [1..5]: seed = SMA([1,2,3]) = 2.
    // alpha = 2/(3+1) = 0.5
    // ema[3] = 0.5*4 + 0.5*2 = 3
    // ema[4] = 0.5*5 + 0.5*3 = 4
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeCloseTo(3, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it("throws on invalid period", () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
    expect(() => ema([1, 2], 3)).toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/ema.test.ts`
Expected: FAIL — no EMA.

- [ ] **Step 3: Write `packages/indicators/src/ema.ts`**

```ts
import type { MaybeSeries, Series } from "./types.js";

export function ema(values: Series, period: number): MaybeSeries {
  if (period < 1) throw new Error("EMA period must be >= 1");
  if (period > values.length) throw new Error("EMA period must be <= input length");
  const out: (number | undefined)[] = new Array(values.length);
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] as number;
  seed /= period;
  let prev = seed;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out[i] = undefined;
    } else if (i === period - 1) {
      out[i] = seed;
    } else {
      const v = values[i] as number;
      const next = alpha * v + (1 - alpha) * prev;
      out[i] = next;
      prev = next;
    }
  }
  return out;
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/ema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add EMA with SMA seed"
```

---

## Task 10: `indicators` — RSI (Wilder)

**Files:**
- Create: `packages/indicators/src/rsi.ts`, `packages/indicators/test/rsi.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write failing test `packages/indicators/test/rsi.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { rsi } from "../src/rsi.js";

describe("rsi (Wilder)", () => {
  it("monotonic-up series yields 100 after seed", () => {
    const out = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14);
    // seed is at index 14; all gains, zero losses → RS = avgGain/0 → RSI = 100
    expect(out[14]).toBe(100);
  });

  it("monotonic-down series yields 0 after seed", () => {
    const out = rsi([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14);
    expect(out[14]).toBe(0);
  });

  it("pre-seed values are undefined", () => {
    const out = rsi([1, 2, 3], 14);
    expect(out.every((v) => v === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/rsi.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/indicators/src/rsi.ts`**

```ts
import type { MaybeSeries, Series } from "./types.js";

export function rsi(values: Series, period = 14): MaybeSeries {
  if (period < 1) throw new Error("RSI period must be >= 1");
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = computeRsi(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = computeRsi(avgGain, avgLoss);
  }
  return out;
}

function computeRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
export * from "./rsi.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/rsi.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add Wilder RSI"
```

---

## Task 11: `indicators` — ATR

**Files:**
- Create: `packages/indicators/src/atr.ts`, `packages/indicators/test/atr.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write failing test `packages/indicators/test/atr.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@forex-bot/contracts";
import { atr } from "../src/atr.js";

function mk(h: number, l: number, c: number, idx = 0): Candle {
  return { ts: idx, open: (h + l) / 2, high: h, low: l, close: c, volume: 0 };
}

describe("atr (Wilder)", () => {
  it("pre-seed indices are undefined", () => {
    const cs = [mk(2, 1, 1.5), mk(2, 1, 1.5)];
    const out = atr(cs, 14);
    expect(out.every((v) => v === undefined)).toBe(true);
  });

  it("constant-range series has ATR equal to that range", () => {
    const cs = Array.from({ length: 20 }, (_, i) => mk(2, 1, 1.5, i));
    const out = atr(cs, 14);
    for (let i = 14; i < cs.length; i++) expect(out[i]).toBeCloseTo(1, 10);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/atr.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/indicators/src/atr.ts`**

```ts
import type { Candle } from "@forex-bot/contracts";
import type { MaybeSeries } from "./types.js";

export function atr(candles: readonly Candle[], period = 14): MaybeSeries {
  if (period < 1) throw new Error("ATR period must be >= 1");
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  if (candles.length <= period) return out;
  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = (candles[0] as Candle).high - (candles[0] as Candle).low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i] as Candle;
    const prev = candles[i - 1] as Candle;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  let avg = 0;
  for (let i = 1; i <= period; i++) avg += tr[i] as number;
  avg /= period;
  out[period] = avg;
  for (let i = period + 1; i < candles.length; i++) {
    avg = (avg * (period - 1) + (tr[i] as number)) / period;
    out[i] = avg;
  }
  return out;
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
export * from "./rsi.js";
export * from "./atr.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/atr.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add Wilder ATR"
```

---

## Task 12: `indicators` — ADX

**Files:**
- Create: `packages/indicators/src/adx.ts`, `packages/indicators/test/adx.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write failing test `packages/indicators/test/adx.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@forex-bot/contracts";
import { adx } from "../src/adx.js";

function mk(h: number, l: number, c: number, idx = 0): Candle {
  return { ts: idx, open: (h + l) / 2, high: h, low: l, close: c, volume: 0 };
}

describe("adx", () => {
  it("returns undefined before 2*period warmup", () => {
    const cs = Array.from({ length: 10 }, (_, i) => mk(2, 1, 1.5, i));
    const out = adx(cs, 14);
    expect(out.every((v) => v === undefined)).toBe(true);
  });

  it("strong monotonic uptrend produces high ADX (>50) after warmup", () => {
    const cs = Array.from({ length: 60 }, (_, i) => mk(1 + i * 0.01 + 0.005, 1 + i * 0.01, 1 + i * 0.01 + 0.004, i));
    const out = adx(cs, 14);
    const last = out[out.length - 1];
    expect(typeof last).toBe("number");
    expect(last as number).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/adx.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/indicators/src/adx.ts`**

```ts
import type { Candle } from "@forex-bot/contracts";
import type { MaybeSeries } from "./types.js";

export function adx(candles: readonly Candle[], period = 14): MaybeSeries {
  if (period < 1) throw new Error("ADX period must be >= 1");
  const n = candles.length;
  const out: (number | undefined)[] = new Array(n).fill(undefined);
  if (n < 2 * period) return out;

  const tr: number[] = new Array(n).fill(0);
  const plusDm: number[] = new Array(n).fill(0);
  const minusDm: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const c = candles[i] as Candle;
    const p = candles[i - 1] as Candle;
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }

  let atrSum = 0;
  let plusSum = 0;
  let minusSum = 0;
  for (let i = 1; i <= period; i++) {
    atrSum += tr[i] as number;
    plusSum += plusDm[i] as number;
    minusSum += minusDm[i] as number;
  }

  const dx: (number | undefined)[] = new Array(n).fill(undefined);
  const plusDi = (plusSum / atrSum) * 100;
  const minusDi = (minusSum / atrSum) * 100;
  dx[period] = (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100;

  let smoothedAtr = atrSum;
  let smoothedPlus = plusSum;
  let smoothedMinus = minusSum;

  for (let i = period + 1; i < n; i++) {
    smoothedAtr = smoothedAtr - smoothedAtr / period + (tr[i] as number);
    smoothedPlus = smoothedPlus - smoothedPlus / period + (plusDm[i] as number);
    smoothedMinus = smoothedMinus - smoothedMinus / period + (minusDm[i] as number);
    const pdi = (smoothedPlus / smoothedAtr) * 100;
    const mdi = (smoothedMinus / smoothedAtr) * 100;
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : (Math.abs(pdi - mdi) / denom) * 100;
  }

  let adxSum = 0;
  for (let i = period; i < 2 * period; i++) adxSum += dx[i] as number;
  let current = adxSum / period;
  out[2 * period - 1] = current;
  for (let i = 2 * period; i < n; i++) {
    current = (current * (period - 1) + (dx[i] as number)) / period;
    out[i] = current;
  }
  return out;
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
export * from "./rsi.js";
export * from "./atr.js";
export * from "./adx.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/adx.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add ADX with DI smoothing"
```

---

## Task 13: `indicators` — Bollinger Bands

**Files:**
- Create: `packages/indicators/src/bollinger.ts`, `packages/indicators/test/bollinger.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write failing test `packages/indicators/test/bollinger.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { bollinger } from "../src/bollinger.js";

describe("bollinger", () => {
  it("flat series → bands collapse to middle", () => {
    const out = bollinger([5, 5, 5, 5, 5, 5], 3, 2);
    const last = out[out.length - 1];
    expect(last?.middle).toBe(5);
    expect(last?.upper).toBe(5);
    expect(last?.lower).toBe(5);
  });

  it("upper - lower = 2 * k * stddev", () => {
    const out = bollinger([1, 2, 3, 4, 5], 5, 2);
    const last = out[out.length - 1];
    const mean = 3;
    const sd = Math.sqrt(((1 - mean) ** 2 + (2 - mean) ** 2 + 0 + (4 - mean) ** 2 + (5 - mean) ** 2) / 5);
    expect(last?.middle).toBeCloseTo(mean, 10);
    expect((last?.upper as number) - (last?.lower as number)).toBeCloseTo(4 * sd, 10);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/bollinger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/indicators/src/bollinger.ts`**

```ts
import type { Series } from "./types.js";

export interface BollingerPoint {
  upper: number;
  middle: number;
  lower: number;
}

export function bollinger(values: Series, period = 20, k = 2): (BollingerPoint | undefined)[] {
  if (period < 1) throw new Error("Bollinger period must be >= 1");
  if (period > values.length) throw new Error("Bollinger period must be <= input length");
  const out: (BollingerPoint | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j] as number;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += ((values[j] as number) - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    out[i] = { upper: mean + k * sd, middle: mean, lower: mean - k * sd };
  }
  return out;
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
export * from "./rsi.js";
export * from "./atr.js";
export * from "./adx.js";
export * from "./bollinger.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/bollinger.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add Bollinger Bands"
```

---

## Task 14: `indicators` — swing high/low detection

**Files:**
- Create: `packages/indicators/src/swings.ts`, `packages/indicators/test/swings.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write failing test `packages/indicators/test/swings.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@forex-bot/contracts";
import { swings } from "../src/swings.js";

function mk(h: number, l: number, idx: number): Candle {
  return { ts: idx, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 0 };
}

describe("swings", () => {
  it("identifies a fractal swing high/low with lookback=2", () => {
    const cs = [mk(1, 0.5, 0), mk(1.2, 0.7, 1), mk(1.5, 0.9, 2), mk(1.3, 0.6, 3), mk(1.1, 0.4, 4)];
    const out = swings(cs, 2);
    expect(out.highs).toContain(2);
    expect(out.lows).toContain(4);
  });

  it("ignores boundary candles within lookback", () => {
    const cs = [mk(2, 1, 0), mk(1, 0.5, 1), mk(1, 0.5, 2), mk(1, 0.5, 3), mk(2, 1, 4)];
    const out = swings(cs, 2);
    expect(out.highs).not.toContain(0);
    expect(out.highs).not.toContain(4);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/swings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/indicators/src/swings.ts`**

```ts
import type { Candle } from "@forex-bot/contracts";

export interface Swings {
  highs: readonly number[];
  lows: readonly number[];
}

export function swings(candles: readonly Candle[], lookback = 2): Swings {
  if (lookback < 1) throw new Error("lookback must be >= 1");
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i] as Candle;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= lookback; k++) {
      const left = candles[i - k] as Candle;
      const right = candles[i + k] as Candle;
      if (!(c.high > left.high && c.high > right.high)) isHigh = false;
      if (!(c.low < left.low && c.low < right.low)) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
export * from "./rsi.js";
export * from "./atr.js";
export * from "./adx.js";
export * from "./bollinger.js";
export * from "./swings.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/swings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add fractal swing high/low detection"
```

---

## Task 15: `indicators` — support/resistance clusters

**Files:**
- Create: `packages/indicators/src/support-resistance.ts`, `packages/indicators/test/support-resistance.test.ts`
- Modify: `packages/indicators/src/index.ts`

- [ ] **Step 1: Write failing test `packages/indicators/test/support-resistance.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { clusterLevels } from "../src/support-resistance.js";

describe("support-resistance clusterLevels", () => {
  it("clusters close levels within tolerance", () => {
    // Sorted: [1.0805, 1.081, 1.0815, 1.095, 1.0955]. Tolerance 0.0015.
    // Head-to-current distance: 0.0005, 0.001, 0.0145, 0.0005 → cluster 1 has 3 items, cluster 2 has 2.
    const clusters = clusterLevels([1.0805, 1.081, 1.0815, 1.095, 1.0955], 0.0015);
    expect(clusters).toEqual([
      { price: expect.closeTo(1.081, 5), touches: 3 },
      { price: expect.closeTo(1.09525, 5), touches: 2 },
    ]);
  });

  it("empty input → empty output", () => {
    expect(clusterLevels([], 0.001)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/indicators/test/support-resistance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/indicators/src/support-resistance.ts`**

```ts
export interface Level {
  price: number;
  touches: number;
}

export function clusterLevels(prices: readonly number[], tolerance: number): Level[] {
  if (tolerance <= 0) throw new Error("tolerance must be > 0");
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const out: Level[] = [];
  let bucket: number[] = [sorted[0] as number];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i] as number;
    const head = bucket[0] as number;
    if (cur - head <= tolerance) {
      bucket.push(cur);
    } else {
      out.push(avgLevel(bucket));
      bucket = [cur];
    }
  }
  out.push(avgLevel(bucket));
  return out;
}

function avgLevel(bucket: readonly number[]): Level {
  const sum = bucket.reduce((a, b) => a + b, 0);
  return { price: sum / bucket.length, touches: bucket.length };
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./types.js";
export * from "./sma.js";
export * from "./ema.js";
export * from "./rsi.js";
export * from "./atr.js";
export * from "./adx.js";
export * from "./bollinger.js";
export * from "./swings.js";
export * from "./support-resistance.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/indicators/test/support-resistance.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck all packages**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/indicators
git commit -m "feat(indicators): add support/resistance clustering"
```

---

## Task 16: `risk` package scaffold + kill-switch state machine

**Files:**
- Create: `packages/risk/package.json`, `packages/risk/tsconfig.json`, `packages/risk/src/kill-switch.ts`, `packages/risk/src/index.ts`, `packages/risk/test/kill-switch.test.ts`

- [ ] **Step 1: Write `packages/risk/package.json`**

```json
{
  "name": "@forex-bot/risk",
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
    "@forex-bot/contracts": "workspace:*"
  }
}
```

- [ ] **Step 2: Write `packages/risk/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "compilerOptions": { "rootDir": "." }
}
```

- [ ] **Step 3: Write failing test `packages/risk/test/kill-switch.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { KillSwitch, type KillSwitchState } from "../src/kill-switch.js";

describe("KillSwitch", () => {
  it("starts untripped", () => {
    const ks = new KillSwitch();
    expect(ks.state().tripped).toBe(false);
  });

  it("auto-trips on daily DD exceeded", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: -3.5, totalDdPct: -2, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    expect(ks.state().reason).toContain("daily");
  });

  it("trips on stale feed", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: 0, totalDdPct: 0, consecutiveLosses: 0, lastFeedAgeSec: 60 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    expect(ks.state().reason).toContain("feed");
  });

  it("requires explicit reset()", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: -10, totalDdPct: 0, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    ks.observe({ dailyPnlPct: 0, totalDdPct: 0, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true); // still tripped
    ks.reset();
    expect(ks.state().tripped).toBe(false);
  });

  it("serializes and rehydrates state", () => {
    const ks = new KillSwitch({ tripped: true, reason: "manual", trippedAt: 123 } satisfies KillSwitchState);
    expect(ks.state().tripped).toBe(true);
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/kill-switch.test.ts`
Expected: FAIL.

- [ ] **Step 5: Write `packages/risk/src/kill-switch.ts`**

```ts
export interface KillSwitchState {
  tripped: boolean;
  reason?: string;
  trippedAt?: number;
}

export interface KillSwitchObservation {
  dailyPnlPct: number;
  totalDdPct: number;
  consecutiveLosses: number;
  lastFeedAgeSec: number;
}

export interface KillSwitchThresholds {
  maxDailyLossPct: number;
  maxTotalDrawdownPct: number;
  maxConsecutiveLosses: number;
  feedStaleSec: number;
}

export class KillSwitch {
  private s: KillSwitchState;

  constructor(initial: KillSwitchState = { tripped: false }) {
    this.s = { ...initial };
  }

  state(): KillSwitchState {
    return { ...this.s };
  }

  reset(): void {
    this.s = { tripped: false };
  }

  observe(obs: KillSwitchObservation, t: KillSwitchThresholds, now = Date.now()): void {
    if (this.s.tripped) return;
    if (obs.dailyPnlPct <= -t.maxDailyLossPct) return this.trip("daily loss cap exceeded", now);
    if (obs.totalDdPct <= -t.maxTotalDrawdownPct) return this.trip("total drawdown cap exceeded", now);
    if (obs.consecutiveLosses >= t.maxConsecutiveLosses) return this.trip("consecutive losses exceeded", now);
    if (obs.lastFeedAgeSec >= t.feedStaleSec) return this.trip("feed stale", now);
  }

  tripManual(reason: string, now = Date.now()): void {
    this.trip(`manual: ${reason}`, now);
  }

  private trip(reason: string, now: number): void {
    this.s = { tripped: true, reason, trippedAt: now };
  }
}
```

- [ ] **Step 6: Write `packages/risk/src/index.ts`**

```ts
export * from "./kill-switch.js";
```

- [ ] **Step 7: Run test**

Run: `pnpm vitest run packages/risk/test/kill-switch.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add KillSwitch state machine with auto and manual trip"
```

---

## Task 17: `risk` — lot sizing math

**Files:**
- Create: `packages/risk/src/sizing.ts`, `packages/risk/test/sizing.test.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/sizing.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeLotSize } from "../src/sizing.js";

describe("computeLotSize", () => {
  it("1% of $10k on EURUSD with 50 pip SL ≈ 0.20 lots", () => {
    const lot = computeLotSize({
      equity: 10000, riskPct: 1, stopDistancePips: 50, pipValuePerLot: 10, maxLotSize: 2,
    });
    expect(lot).toBeCloseTo(0.2, 2);
  });

  it("clamps to maxLotSize", () => {
    const lot = computeLotSize({
      equity: 10_000_000, riskPct: 1, stopDistancePips: 50, pipValuePerLot: 10, maxLotSize: 2,
    });
    expect(lot).toBe(2);
  });

  it("rounds down to 0.01 increments", () => {
    const lot = computeLotSize({
      equity: 10000, riskPct: 1, stopDistancePips: 123, pipValuePerLot: 10, maxLotSize: 5,
    });
    expect(Math.round(lot * 100) / 100).toBe(lot);
    expect(lot).toBeLessThan(0.09);
  });

  it("property: realized risk never exceeds riskPct × equity", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 100, noNaN: true, noDefaultInfinity: true }),
        (equity, riskPct, stopPips, pipValue) => {
          const lot = computeLotSize({
            equity, riskPct, stopDistancePips: stopPips, pipValuePerLot: pipValue, maxLotSize: 100,
          });
          const risk = lot * stopPips * pipValue;
          const cap = (riskPct / 100) * equity;
          return risk <= cap + 1e-6;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("returns 0 if stopDistancePips is 0 (refuse unsafe entry)", () => {
    expect(
      computeLotSize({ equity: 10000, riskPct: 1, stopDistancePips: 0, pipValuePerLot: 10, maxLotSize: 2 }),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/sizing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Install fast-check at the workspace root**

Run: `pnpm add -w -D fast-check` (already in root devDeps; skip if already installed).

- [ ] **Step 4: Write `packages/risk/src/sizing.ts`**

```ts
export interface LotSizeInput {
  equity: number;            // account equity in account currency
  riskPct: number;           // percent (e.g. 1 for 1%)
  stopDistancePips: number;  // distance from entry to SL, in pips
  pipValuePerLot: number;    // currency value of 1 pip for 1 standard lot
  maxLotSize: number;        // absolute cap
}

export function computeLotSize(input: LotSizeInput): number {
  const { equity, riskPct, stopDistancePips, pipValuePerLot, maxLotSize } = input;
  if (stopDistancePips <= 0) return 0;
  if (pipValuePerLot <= 0) return 0;
  const maxRisk = (riskPct / 100) * equity;
  const rawLot = maxRisk / (stopDistancePips * pipValuePerLot);
  const capped = Math.min(rawLot, maxLotSize);
  return Math.floor(capped * 100) / 100;
}
```

- [ ] **Step 5: Update index**

```ts
export * from "./kill-switch.js";
export * from "./sizing.js";
```

- [ ] **Step 6: Run test**

Run: `pnpm vitest run packages/risk/test/sizing.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add lot sizing with max-risk invariant (property-tested)"
```

---

## Task 18: `risk` — correlation matrix + exposure math

**Files:**
- Create: `packages/risk/src/correlation.ts`, `packages/risk/test/correlation.test.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/correlation.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@forex-bot/contracts";
import { CorrelationMatrix, netCorrelatedRiskPct } from "../src/correlation.js";

const M = new CorrelationMatrix({
  EURUSD: { GBPUSD: 0.8, USDJPY: -0.6 },
  GBPUSD: { EURUSD: 0.8, USDJPY: -0.5 },
  USDJPY: { EURUSD: -0.6, GBPUSD: -0.5 },
});

function pos(symbol: "EURUSD" | "GBPUSD" | "USDJPY", side: "buy" | "sell", lot: number): Position {
  return {
    id: `${symbol}-${side}`,
    symbol,
    side,
    lotSize: lot,
    entry: 1,
    sl: side === "buy" ? 0.9 : 1.1,
    tp: side === "buy" ? 1.1 : 0.9,
    openedAt: 0,
  };
}

describe("correlation", () => {
  it("two highly-correlated longs summed as same-direction exposure", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("GBPUSD", "buy", 0.1)],
      positionRiskPct: (p) => 1, // each open trade = 1% risk
      threshold: 0.6,
    });
    // both long + correlation 0.8 >= 0.6 → risk sums
    expect(risk).toBeGreaterThanOrEqual(2);
  });

  it("opposite direction correlated trades offset", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("GBPUSD", "sell", 0.1)],
      positionRiskPct: (p) => 1,
      threshold: 0.6,
    });
    expect(risk).toBeCloseTo(0, 6);
  });

  it("uncorrelated pair does not contribute", () => {
    const risk = netCorrelatedRiskPct({
      matrix: M,
      newSymbol: "EURUSD",
      newSide: "buy",
      newRiskPct: 1,
      openPositions: [pos("USDJPY", "buy", 0.1)], // corr -0.6 opposite → offset
      positionRiskPct: (p) => 1,
      threshold: 0.6,
    });
    expect(Math.abs(risk)).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/correlation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/correlation.ts`**

```ts
import type { Position, Symbol } from "@forex-bot/contracts";

export type CorrelationEntry = Record<Symbol, number>;

export class CorrelationMatrix {
  constructor(private readonly data: Record<Symbol, CorrelationEntry>) {}

  corr(a: Symbol, b: Symbol): number {
    if (a === b) return 1;
    return this.data[a]?.[b] ?? 0;
  }
}

export interface NetRiskInput {
  matrix: CorrelationMatrix;
  newSymbol: Symbol;
  newSide: "buy" | "sell";
  newRiskPct: number;
  openPositions: readonly Position[];
  positionRiskPct: (p: Position) => number;
  threshold: number;
}

export function netCorrelatedRiskPct(input: NetRiskInput): number {
  const { matrix, newSymbol, newSide, newRiskPct, openPositions, positionRiskPct, threshold } = input;
  const newSign = newSide === "buy" ? 1 : -1;
  let net = newSign * newRiskPct;
  for (const p of openPositions) {
    const c = matrix.corr(newSymbol, p.symbol);
    if (Math.abs(c) < threshold) continue;
    const effectiveSign = (p.side === "buy" ? 1 : -1) * Math.sign(c);
    net += effectiveSign * positionRiskPct(p);
  }
  return Math.abs(net);
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./kill-switch.js";
export * from "./sizing.js";
export * from "./correlation.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/risk/test/correlation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add correlation matrix + net-correlated exposure math"
```

---

## Task 19: `risk` — gate types and shared context

**Files:**
- Create: `packages/risk/src/gates/types.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write `packages/risk/src/gates/types.ts`**

```ts
import type {
  AccountState,
  CalendarEvent,
  PendingOrder,
  Position,
  RiskConfig,
  Symbol,
} from "@forex-bot/contracts";
import type { CorrelationMatrix } from "../correlation.js";
import type { KillSwitch } from "../kill-switch.js";

export interface GateContext {
  now: number;                            // unix ms
  order: PendingOrder;                    // proposed entry from Verdict + sizing
  account: AccountState;
  openPositions: readonly Position[];
  config: RiskConfig;
  currentSpreadPips: number;
  medianSpreadPips: number;
  atrPips: number;
  session: "asia" | "london" | "ny" | "overlap_ny_london" | "off";
  upcomingEvents: readonly CalendarEvent[];
  correlation: CorrelationMatrix;
  killSwitch: KillSwitch;
  consecutiveLosses: number;
  dailyPnlPct: number;
  totalDdPct: number;
  feedAgeSec: number;
  currencyExposurePct: Record<string, number>; // { USD: 4.5, EUR: 2 }
  affectedCurrencies: (symbol: Symbol) => readonly string[]; // e.g. EURUSD → ["EUR","USD"]
  pipValuePerLot: (symbol: Symbol) => number;
}

export interface GateResult {
  pass: boolean;
  gate: string;
  reason?: string;
}

export type Gate = (ctx: GateContext) => GateResult;
```

- [ ] **Step 2: Update index**

```ts
export * from "./kill-switch.js";
export * from "./sizing.js";
export * from "./correlation.js";
export * from "./gates/types.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): define shared Gate/GateContext/GateResult"
```

---

## Task 20: Risk gate — kill-switch

**Files:**
- Create: `packages/risk/src/gates/kill-switch.ts`, `packages/risk/test/gates-kill-switch.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-kill-switch.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { killSwitchGate } from "../src/gates/kill-switch.js";
import { KillSwitch } from "../src/kill-switch.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("killSwitchGate", () => {
  it("passes when switch not tripped", () => {
    const ks = new KillSwitch();
    const r = killSwitchGate(mkGateCtx({ killSwitch: ks }));
    expect(r.pass).toBe(true);
  });

  it("blocks when switch is tripped", () => {
    const ks = new KillSwitch();
    ks.tripManual("test");
    const r = killSwitchGate(mkGateCtx({ killSwitch: ks }));
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("kill-switch");
  });
});
```

- [ ] **Step 2: Write `packages/risk/test/helpers/ctx.ts`**

```ts
import type { GateContext } from "../../src/gates/types.js";
import { KillSwitch } from "../../src/kill-switch.js";
import { CorrelationMatrix } from "../../src/correlation.js";
import { defaultRiskConfig } from "@forex-bot/contracts";

export function mkGateCtx(overrides: Partial<GateContext> = {}): GateContext {
  const base: GateContext = {
    now: 1_700_000_000_000,
    order: {
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      entry: 1.08,
      sl: 1.075,
      tp: 1.09,
      expiresAt: 1_700_000_300_000,
    },
    account: {
      ts: 1_700_000_000_000,
      currency: "USD",
      balance: 10_000,
      equity: 10_000,
      freeMargin: 9_500,
      usedMargin: 500,
      marginLevelPct: 2000,
    },
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: 40,
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
  return { ...base, ...overrides };
}
```

- [ ] **Step 3: Run test**

Run: `pnpm vitest run packages/risk/test/gates-kill-switch.test.ts`
Expected: FAIL (gate not defined).

- [ ] **Step 4: Write `packages/risk/src/gates/kill-switch.ts`**

```ts
import type { Gate } from "./types.js";

export const killSwitchGate: Gate = (ctx) => {
  const s = ctx.killSwitch.state();
  if (s.tripped) {
    return { pass: false, gate: "kill-switch", reason: `kill-switch tripped: ${s.reason ?? "unknown"}` };
  }
  return { pass: true, gate: "kill-switch" };
};
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/risk/test/gates-kill-switch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add kill-switch gate + test helpers"
```

---

## Task 21: Risk gate — spread

**Files:**
- Create: `packages/risk/src/gates/spread.ts`, `packages/risk/test/gates-spread.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-spread.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { spreadGate } from "../src/gates/spread.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("spreadGate", () => {
  it("passes when current spread <= median × multiplier", () => {
    const r = spreadGate(mkGateCtx({ currentSpreadPips: 1.8, medianSpreadPips: 1.0 }));
    expect(r.pass).toBe(true);
  });

  it("blocks when current spread > median × multiplier", () => {
    const r = spreadGate(mkGateCtx({ currentSpreadPips: 3, medianSpreadPips: 1.0 }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/spread/i);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-spread.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/spread.ts`**

```ts
import type { Gate } from "./types.js";

export const spreadGate: Gate = (ctx) => {
  const cap = ctx.medianSpreadPips * ctx.config.execution.maxSpreadMultiplier;
  if (ctx.currentSpreadPips > cap) {
    return {
      pass: false,
      gate: "spread",
      reason: `spread ${ctx.currentSpreadPips.toFixed(2)}p > cap ${cap.toFixed(2)}p`,
    };
  }
  return { pass: true, gate: "spread" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-spread.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add spread gate"
```

---

## Task 22: Risk gate — session

**Files:**
- Create: `packages/risk/src/gates/session.ts`, `packages/risk/test/gates-session.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-session.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { sessionGate } from "../src/gates/session.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("sessionGate", () => {
  it("blocks EURUSD during Asia (allowed is a restricted list)", () => {
    const r = sessionGate(mkGateCtx({ session: "asia", order: { ...mkGateCtx().order, symbol: "EURUSD" } }));
    expect(r.pass).toBe(false);
  });

  it("allows USDJPY during Asia", () => {
    const r = sessionGate(mkGateCtx({ session: "asia", order: { ...mkGateCtx().order, symbol: "USDJPY" } }));
    expect(r.pass).toBe(true);
  });

  it("allows any symbol during London (allowed=all)", () => {
    const r = sessionGate(mkGateCtx({ session: "london", order: { ...mkGateCtx().order, symbol: "EURUSD" } }));
    expect(r.pass).toBe(true);
  });

  it("blocks during off-session", () => {
    const r = sessionGate(mkGateCtx({ session: "off" }));
    expect(r.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/session.ts`**

```ts
import type { Symbol } from "@forex-bot/contracts";
import type { Gate } from "./types.js";

export const sessionGate: Gate = (ctx) => {
  if (ctx.session === "off") return { pass: false, gate: "session", reason: "off-session" };
  const cfg = ctx.config.sessions;
  const spec =
    ctx.session === "asia" ? cfg.asia :
    ctx.session === "london" ? cfg.london :
    ctx.session === "ny" ? cfg.ny :
    { allowed: "all" as const };
  const allowed = spec.allowed;
  if (allowed === "all") return { pass: true, gate: "session" };
  if ((allowed as readonly Symbol[]).includes(ctx.order.symbol)) {
    return { pass: true, gate: "session" };
  }
  return {
    pass: false,
    gate: "session",
    reason: `${ctx.order.symbol} not allowed in ${ctx.session}`,
  };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add session gate"
```

---

## Task 23: Risk gate — news blackout

**Files:**
- Create: `packages/risk/src/gates/news-blackout.ts`, `packages/risk/test/gates-news-blackout.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-news-blackout.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { newsBlackoutGate } from "../src/gates/news-blackout.js";
import { mkGateCtx } from "./helpers/ctx.js";

const NOW = 1_700_000_000_000;

describe("newsBlackoutGate", () => {
  it("blocks within blackout window for affected currency", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        order: { ...mkGateCtx().order, symbol: "EURUSD" },
        upcomingEvents: [
          { ts: NOW + 5 * 60_000, currency: "USD", impact: "high", title: "CPI" },
        ],
      }),
    );
    expect(r.pass).toBe(false);
  });

  it("allows outside window", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        upcomingEvents: [
          { ts: NOW + 60 * 60_000, currency: "USD", impact: "high", title: "CPI" },
        ],
      }),
    );
    expect(r.pass).toBe(true);
  });

  it("ignores low-impact events", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        upcomingEvents: [
          { ts: NOW + 2 * 60_000, currency: "USD", impact: "low", title: "x" },
        ],
      }),
    );
    expect(r.pass).toBe(true);
  });

  it("ignores unaffected currencies", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        order: { ...mkGateCtx().order, symbol: "EURUSD" },
        upcomingEvents: [
          { ts: NOW + 2 * 60_000, currency: "JPY", impact: "high", title: "x" },
        ],
      }),
    );
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-news-blackout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/news-blackout.ts`**

```ts
import type { Gate } from "./types.js";

export const newsBlackoutGate: Gate = (ctx) => {
  const windowMs = ctx.config.newsBlackout.highImpactWindowMin * 60_000;
  const postMs = ctx.config.newsBlackout.postReleaseCalmMin * 60_000;
  const affected = new Set(ctx.affectedCurrencies(ctx.order.symbol));
  for (const e of ctx.upcomingEvents) {
    if (e.impact !== "high") continue;
    if (!affected.has(e.currency)) continue;
    const before = e.ts - windowMs;
    const after = e.ts + postMs;
    if (ctx.now >= before && ctx.now <= after) {
      return {
        pass: false,
        gate: "news-blackout",
        reason: `within blackout of ${e.title} (${e.currency})`,
      };
    }
  }
  return { pass: true, gate: "news-blackout" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-news-blackout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add news-blackout gate"
```

---

## Task 24: Risk gate — correlation cap

**Files:**
- Create: `packages/risk/src/gates/correlation.ts`, `packages/risk/test/gates-correlation.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-correlation.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@forex-bot/contracts";
import { correlationGate } from "../src/gates/correlation.js";
import { CorrelationMatrix } from "../src/correlation.js";
import { mkGateCtx } from "./helpers/ctx.js";

const mat = new CorrelationMatrix({ EURUSD: { GBPUSD: 0.9 }, GBPUSD: { EURUSD: 0.9 } });

function p(symbol: "EURUSD" | "GBPUSD", side: "buy" | "sell"): Position {
  return {
    id: `${symbol}-${side}`,
    symbol,
    side,
    lotSize: 0.1,
    entry: 1,
    sl: side === "buy" ? 0.9 : 1.1,
    tp: side === "buy" ? 1.1 : 0.9,
    openedAt: 0,
  };
}

describe("correlationGate", () => {
  it("blocks when net correlated exposure would exceed cap", () => {
    const r = correlationGate(
      mkGateCtx({
        correlation: mat,
        openPositions: [p("GBPUSD", "buy")],
      }),
    );
    expect(r.pass).toBe(false);
  });

  it("passes when opposite direction offsets", () => {
    const r = correlationGate(
      mkGateCtx({
        correlation: mat,
        openPositions: [p("GBPUSD", "sell")],
      }),
    );
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-correlation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/correlation.ts`**

```ts
import type { Gate } from "./types.js";
import { netCorrelatedRiskPct } from "../correlation.js";

export const correlationGate: Gate = (ctx) => {
  const net = netCorrelatedRiskPct({
    matrix: ctx.correlation,
    newSymbol: ctx.order.symbol,
    newSide: ctx.order.side,
    newRiskPct: ctx.config.perTrade.riskPct,
    openPositions: ctx.openPositions,
    positionRiskPct: () => ctx.config.perTrade.riskPct,
    threshold: 0.6,
  });
  const cap = ctx.config.correlation.maxNetCorrelatedExposurePct;
  if (net > cap) {
    return {
      pass: false,
      gate: "correlation",
      reason: `net correlated exposure ${net.toFixed(2)}% > cap ${cap}%`,
    };
  }
  return { pass: true, gate: "correlation" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-correlation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add correlation gate"
```

---

## Task 25: Risk gate — per-currency exposure

**Files:**
- Create: `packages/risk/src/gates/currency-exposure.ts`, `packages/risk/test/gates-currency-exposure.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-currency-exposure.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { currencyExposureGate } from "../src/gates/currency-exposure.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("currencyExposureGate", () => {
  it("blocks when adding new trade pushes any currency over cap", () => {
    const r = currencyExposureGate(
      mkGateCtx({
        currencyExposurePct: { USD: 5.5, EUR: 2 },
        // new EURUSD adds 1% each side → USD becomes 6.5, cap is 6
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/USD/);
  });

  it("passes when exposures stay under cap", () => {
    const r = currencyExposureGate(
      mkGateCtx({ currencyExposurePct: { USD: 2, EUR: 1 } }),
    );
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-currency-exposure.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/currency-exposure.ts`**

```ts
import type { Gate } from "./types.js";

export const currencyExposureGate: Gate = (ctx) => {
  const cap = ctx.config.account.maxExposurePerCurrencyPct;
  const add = ctx.config.perTrade.riskPct;
  const affected = ctx.affectedCurrencies(ctx.order.symbol);
  for (const ccy of affected) {
    const current = ctx.currencyExposurePct[ccy] ?? 0;
    if (current + add > cap) {
      return {
        pass: false,
        gate: "currency-exposure",
        reason: `${ccy} exposure ${(current + add).toFixed(2)}% > cap ${cap}%`,
      };
    }
  }
  return { pass: true, gate: "currency-exposure" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-currency-exposure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add per-currency exposure gate"
```

---

## Task 26: Risk gate — concurrent positions

**Files:**
- Create: `packages/risk/src/gates/concurrent.ts`, `packages/risk/test/gates-concurrent.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-concurrent.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@forex-bot/contracts";
import { concurrentPositionsGate } from "../src/gates/concurrent.js";
import { mkGateCtx } from "./helpers/ctx.js";

function dummy(idx: number): Position {
  return {
    id: `p-${idx}`,
    symbol: "EURUSD",
    side: "buy",
    lotSize: 0.1,
    entry: 1,
    sl: 0.99,
    tp: 1.01,
    openedAt: 0,
  };
}

describe("concurrentPositionsGate", () => {
  it("passes when under cap", () => {
    const r = concurrentPositionsGate(mkGateCtx({ openPositions: [dummy(1), dummy(2)] }));
    expect(r.pass).toBe(true);
  });

  it("blocks when at cap", () => {
    const r = concurrentPositionsGate(
      mkGateCtx({ openPositions: [dummy(1), dummy(2), dummy(3), dummy(4)] }),
    );
    expect(r.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-concurrent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/concurrent.ts`**

```ts
import type { Gate } from "./types.js";

export const concurrentPositionsGate: Gate = (ctx) => {
  const cap = ctx.config.account.maxConcurrentPositions;
  if (ctx.openPositions.length >= cap) {
    return {
      pass: false,
      gate: "concurrent-positions",
      reason: `${ctx.openPositions.length} open >= cap ${cap}`,
    };
  }
  return { pass: true, gate: "concurrent-positions" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-concurrent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add concurrent-positions gate"
```

---

## Task 27: Risk gate — per-trade risk / min-RR / min stop distance

**Files:**
- Create: `packages/risk/src/gates/per-trade-risk.ts`, `packages/risk/test/gates-per-trade-risk.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-per-trade-risk.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { perTradeRiskGate } from "../src/gates/per-trade-risk.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("perTradeRiskGate", () => {
  it("blocks when SL too tight (< minStopDistanceAtr × atrPips)", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 40,
        // entry 1.08, sl 1.0799 → 1 pip stop < 0.5 * 40 = 20 pips
        order: { ...mkGateCtx().order, entry: 1.08, sl: 1.0799, tp: 1.09 },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/stop/i);
  });

  it("blocks when RR < minRR", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 10,
        // stop 50 pips, tp 30 pips → RR 0.6 < 1.5
        order: { ...mkGateCtx().order, entry: 1.08, sl: 1.075, tp: 1.083 },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/RR/i);
  });

  it("passes on a normal setup", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 10,
        order: { ...mkGateCtx().order, entry: 1.08, sl: 1.075, tp: 1.0875 }, // 50 pip stop, 75 pip tp → RR 1.5
      }),
    );
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-per-trade-risk.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/per-trade-risk.ts`**

```ts
import type { Gate } from "./types.js";

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

export const perTradeRiskGate: Gate = (ctx) => {
  const scale = pipScale(ctx.order.symbol);
  const stopPips = Math.abs(ctx.order.entry - ctx.order.sl) / scale;
  const tpPips = Math.abs(ctx.order.tp - ctx.order.entry) / scale;
  const minStop = ctx.config.execution.minStopDistanceAtr * ctx.atrPips;
  if (stopPips < minStop) {
    return {
      pass: false,
      gate: "per-trade-risk",
      reason: `stop ${stopPips.toFixed(1)}p < min ${minStop.toFixed(1)}p`,
    };
  }
  const rr = tpPips / stopPips;
  if (rr < ctx.config.perTrade.minRR) {
    return {
      pass: false,
      gate: "per-trade-risk",
      reason: `RR ${rr.toFixed(2)} < minRR ${ctx.config.perTrade.minRR}`,
    };
  }
  return { pass: true, gate: "per-trade-risk" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-per-trade-risk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add per-trade-risk gate (stop distance + RR)"
```

---

## Task 28: Risk gate — margin buffer

**Files:**
- Create: `packages/risk/src/gates/margin.ts`, `packages/risk/test/gates-margin.test.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/gates-margin.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { marginGate } from "../src/gates/margin.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("marginGate", () => {
  it("blocks when expected used margin after trade exceeds free margin × 0.8", () => {
    const r = marginGate(
      mkGateCtx({
        account: { ...mkGateCtx().account, freeMargin: 100, usedMargin: 0 },
        order: { ...mkGateCtx().order, lotSize: 100 }, // huge
      }),
    );
    expect(r.pass).toBe(false);
  });

  it("passes on tiny order", () => {
    const r = marginGate(mkGateCtx({ order: { ...mkGateCtx().order, lotSize: 0.01 } }));
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/gates-margin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/gates/margin.ts`**

```ts
import type { Gate } from "./types.js";

// Rough notional-based margin estimator. Assumes 1:30 retail leverage.
// notional = lotSize * 100_000 * entry
// required margin = notional / 30
export const marginGate: Gate = (ctx) => {
  const notional = ctx.order.lotSize * 100_000 * ctx.order.entry;
  const required = notional / 30;
  const cap = ctx.account.freeMargin * 0.8;
  if (required > cap) {
    return {
      pass: false,
      gate: "margin",
      reason: `required margin ${required.toFixed(0)} > cap ${cap.toFixed(0)}`,
    };
  }
  return { pass: true, gate: "margin" };
};
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/risk/test/gates-margin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): add margin buffer gate"
```

---

## Task 29: `risk` — compose 9 gates into `evaluate()`

**Files:**
- Create: `packages/risk/src/evaluate.ts`, `packages/risk/test/evaluate.test.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing test `packages/risk/test/evaluate.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { KillSwitch } from "../src/kill-switch.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("evaluate (9-gate chain)", () => {
  it("returns first failing gate (short-circuits)", () => {
    const ks = new KillSwitch();
    ks.tripManual("test");
    const r = evaluate(mkGateCtx({ killSwitch: ks }));
    expect(r.approve).toBe(false);
    if (!r.approve) expect(r.vetoReason).toMatch(/kill-switch/);
  });

  it("approves when all 9 gates pass", () => {
    const r = evaluate(mkGateCtx({
      atrPips: 10,
      order: { ...mkGateCtx().order, entry: 1.08, sl: 1.075, tp: 1.0875 },
    }));
    expect(r.approve).toBe(true);
    if (r.approve) {
      expect(r.lotSize).toBeGreaterThan(0);
      expect(r.reasons.length).toBe(9);
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/risk/test/evaluate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/risk/src/evaluate.ts`**

```ts
import type { RiskDecision } from "@forex-bot/contracts";
import { computeLotSize } from "./sizing.js";
import type { Gate, GateContext } from "./gates/types.js";
import { killSwitchGate } from "./gates/kill-switch.js";
import { spreadGate } from "./gates/spread.js";
import { sessionGate } from "./gates/session.js";
import { newsBlackoutGate } from "./gates/news-blackout.js";
import { correlationGate } from "./gates/correlation.js";
import { currencyExposureGate } from "./gates/currency-exposure.js";
import { concurrentPositionsGate } from "./gates/concurrent.js";
import { perTradeRiskGate } from "./gates/per-trade-risk.js";
import { marginGate } from "./gates/margin.js";

export const gates: readonly Gate[] = [
  killSwitchGate,
  spreadGate,
  sessionGate,
  newsBlackoutGate,
  correlationGate,
  currencyExposureGate,
  concurrentPositionsGate,
  perTradeRiskGate,
  marginGate,
];

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

export function evaluate(ctx: GateContext): RiskDecision {
  // 1. Size from risk caps BEFORE gates so lot-sensitive gates (margin) validate the actual lot.
  const stopPips = Math.abs(ctx.order.entry - ctx.order.sl) / pipScale(ctx.order.symbol);
  const lot = computeLotSize({
    equity: ctx.account.equity,
    riskPct: ctx.config.perTrade.riskPct,
    stopDistancePips: stopPips,
    pipValuePerLot: ctx.pipValuePerLot(ctx.order.symbol),
    maxLotSize: ctx.config.perTrade.maxLotSize,
  });
  if (lot <= 0) {
    return { approve: false, vetoReason: "sizing: computed lot is zero" };
  }

  // 2. Run all 9 gates against the sized order.
  const sizedCtx: GateContext = { ...ctx, order: { ...ctx.order, lotSize: lot } };
  const reasons: string[] = [];
  for (const g of gates) {
    const r = g(sizedCtx);
    if (!r.pass) {
      return { approve: false, vetoReason: `${r.gate}: ${r.reason ?? "blocked"}` };
    }
    reasons.push(`${r.gate}: pass`);
  }

  return {
    approve: true,
    lotSize: lot,
    sl: ctx.order.sl,
    tp: ctx.order.tp,
    expiresAt: ctx.order.expiresAt,
    reasons,
  };
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./kill-switch.js";
export * from "./sizing.js";
export * from "./correlation.js";
export * from "./gates/types.js";
export * from "./gates/kill-switch.js";
export * from "./gates/spread.js";
export * from "./gates/session.js";
export * from "./gates/news-blackout.js";
export * from "./gates/correlation.js";
export * from "./gates/currency-exposure.js";
export * from "./gates/concurrent.js";
export * from "./gates/per-trade-risk.js";
export * from "./gates/margin.js";
export * from "./evaluate.js";
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS (every package).

- [ ] **Step 6: Typecheck everything**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 7: Coverage check**

Run: `pnpm vitest run --coverage`
Expected: coverage thresholds from `vitest.config.ts` met (≥90% across packages).

- [ ] **Step 8: Commit**

```bash
git add packages/risk
git commit -m "feat(risk): compose 9-gate evaluate() producing RiskDecision"
```

---

## Task 30: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm lint
      - run: pnpm test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
```

- [ ] **Step 2: Verify locally**

Run: `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: add typecheck + lint + test + coverage workflow"
```

---

## Done-Done Checklist

Before declaring Plan 1 complete:

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean clone.
- [ ] `pnpm -r typecheck` has zero errors.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes, all 3 packages green.
- [ ] `pnpm vitest run --coverage` meets ≥90% thresholds.
- [ ] CI workflow file is present and GitHub Actions (once remote is configured) runs green on main.
- [ ] Every task above has its own commit in git history.
- [ ] `packages/contracts/src/index.ts` re-exports every schema file.
- [ ] `packages/indicators/src/index.ts` re-exports every indicator.
- [ ] `packages/risk/src/index.ts` re-exports every gate + evaluator.
- [ ] No package imports a sibling package except via `@forex-bot/<name>`.
- [ ] No package uses `any`, `as unknown as`, or network / disk I/O.

## What comes next (future plans)

- **Plan 2 — MT5 Bridge**: Python gRPC sidecar + `broker-mt5` adapter + `executor` package. Consumes `RiskDecision` + `PendingOrder` contracts. Adds order state machine.
- **Plan 3 — Data Layer**: `news`, `calendar`, central-bank adapters + `data-ingest` app + `memory` package (pgvector + DynamoDB). Produces `NewsHeadline`, `CalendarEvent` streams.
- **Plan 4 — Agent Graph**: LangGraph.js graph + analyst/judge/risk-officer/reflection agents + `agent-runner` app. First end-to-end tick.
- **Plan 5 — Eval Harness**: historical replay, event-study, paper-trade runners + expanded CI.
- **Plan 6 — Infra + Ops**: CDK/Terraform, LangSmith, CloudWatch, SNS, `ops-cli`.
- **Plan 7 — Go-Live Controls**: canary config, chaos drills, promotion gates.
