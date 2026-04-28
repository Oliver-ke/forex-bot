# Forex Bot — Plan 3: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the data-ingest pipeline: news/calendar/central-bank/COT adapters behind a shared interface, a `memory` package wrapping pgvector (RAG) + DynamoDB (journal), a Redis-backed hot cache, and a `data-ingest` worker app that schedules them. All unit tests run with in-memory fakes; integration tests gated on docker-compose services so a contributor can run the full suite locally.

**Architecture:**
- `data-core` defines the cross-cutting interfaces (`NewsAdapter`, `CalendarAdapter`, `EmbeddingProvider`, `JournalStore`, `RagStore`, `HotCache`) + in-memory fakes used by every other package's unit tests.
- One adapter package per data source family (`news-rss`, `news-api`, `calendar-forexfactory`, `cb-scrapers`, `cot`). Provider-adapter pattern.
- `memory` package implements `JournalStore` against DynamoDB and `RagStore` against Postgres + pgvector. The embedding model is abstracted behind `EmbeddingProvider` (concrete choice — Voyage / OpenAI / local — deferred per spec §11).
- `cache` package wraps Redis (`ioredis`) with typed accessors per cache key family.
- `apps/data-ingest` schedules workers; each worker is a pure function `tick(now, services) → effect[]` so it's testable in isolation. The scheduler picks workers whose due-time has elapsed.
- Integration tests are gated on environment variables (`PG_TEST_URL`, `DYNAMO_TEST_ENDPOINT`, `REDIS_TEST_URL`); CI provides them via docker compose. Unit tests don't need any of this.

**Tech Stack:** existing TS toolchain + `rss-parser@^3.13`, `linkedom@^0.18` (HTML parse), `pg@^8.13`, `ioredis@^5.4`, `@aws-sdk/client-dynamodb@^3.690`, `@aws-sdk/lib-dynamodb@^3.690`, `msw@^2.7` (HTTP mocking in tests). `docker-compose` for local integration services.

---

## File structure produced by this plan

```
forex-bot/
├── docker-compose.yml
├── packages/
│   ├── data-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── adapters.ts        # NewsAdapter, CalendarAdapter, CotAdapter, CbAdapter
│   │   │   ├── memory.ts          # EmbeddingProvider, JournalStore, RagStore
│   │   │   ├── cache.ts           # HotCache interface
│   │   │   ├── fakes.ts           # InMemory* implementations
│   │   │   └── index.ts
│   │   └── test/
│   ├── news-rss/
│   ├── news-api/
│   ├── calendar-forexfactory/
│   ├── cb-scrapers/
│   ├── cot/
│   ├── memory/
│   └── cache/
└── apps/
    └── data-ingest/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── scheduler.ts
        │   ├── workers/
        │   │   ├── news.ts
        │   │   ├── calendar.ts
        │   │   ├── cb-press.ts
        │   │   └── cot.ts
        │   ├── main.ts
        │   └── index.ts
        └── test/
```

---

## Task 1: `data-core` — adapter & memory interfaces

**Files:**
- Create: `packages/data-core/{package.json,tsconfig.json,src/{adapters.ts,memory.ts,cache.ts,index.ts}}`

- [ ] **Step 1: Write `packages/data-core/package.json`**

```json
{
  "name": "@forex-bot/data-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.json --outDir dist"
  },
  "dependencies": { "@forex-bot/contracts": "workspace:*" }
}
```

- [ ] **Step 2: Write `packages/data-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "compilerOptions": { "rootDir": "." }
}
```

- [ ] **Step 3: Write `packages/data-core/src/adapters.ts`**

```ts
import type { CalendarEvent, NewsHeadline, Symbol } from "@forex-bot/contracts";

export interface FetchWindow {
  /** unix ms — fetch items with ts >= since */
  since: number;
  /** unix ms — fetch items with ts <= until (default: now) */
  until?: number;
}

export interface NewsAdapter {
  /** Source name (e.g. "reuters-rss", "newsapi"). Stable identifier for journal/audit. */
  readonly source: string;
  fetch(window: FetchWindow): Promise<readonly NewsHeadline[]>;
}

export interface CalendarAdapter {
  readonly source: string;
  fetch(window: FetchWindow): Promise<readonly CalendarEvent[]>;
}

export interface CbDocument {
  ts: number;          // publication time (unix ms)
  bank: "FED" | "ECB" | "BOE" | "BOJ" | "SNB" | "RBA" | "RBNZ";
  kind: "press_release" | "speech" | "minutes";
  title: string;
  url: string;
  body: string;        // plain text, normalized
}

export interface CbAdapter {
  readonly source: string;
  fetch(window: FetchWindow): Promise<readonly CbDocument[]>;
}

export interface CotReport {
  ts: number;            // publication time (unix ms)
  symbol: Symbol;        // mapped FX/metal pair
  netNonCommercial: number;  // net contracts
  netCommercial: number;
  changeWeekly: number;
}

export interface CotAdapter {
  readonly source: string;
  fetch(window: FetchWindow): Promise<readonly CotReport[]>;
}
```

- [ ] **Step 4: Write `packages/data-core/src/memory.ts`**

```ts
import type { TradeJournal } from "@forex-bot/contracts";

export interface EmbeddingProvider {
  /** Stable identifier for the model — written into RagDoc.modelVersion. */
  readonly modelVersion: string;
  /** Embedding dimension; must be constant across calls for one provider instance. */
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface JournalStore {
  put(j: TradeJournal): Promise<void>;
  get(tradeId: string): Promise<TradeJournal | undefined>;
  /** List by openedAt descending; supports a simple cursor for pagination. */
  list(opts: { limit: number; cursor?: string }): Promise<{
    items: readonly TradeJournal[];
    nextCursor?: string;
  }>;
}

export interface RagDoc {
  id: string;             // stable id, e.g. tradeId or hash
  text: string;           // canonical text used for embedding
  embedding: readonly number[];
  modelVersion: string;
  metadata: Record<string, string | number | boolean>;
  ts: number;
}

export interface RagStore {
  put(doc: RagDoc): Promise<void>;
  /** Top-K nearest neighbours by cosine similarity. */
  search(query: { embedding: readonly number[]; k: number; filter?: Record<string, string> }): Promise<readonly RagDoc[]>;
}
```

- [ ] **Step 5: Write `packages/data-core/src/cache.ts`**

```ts
import type { AccountState, CalendarEvent, NewsHeadline, Symbol, Tick } from "@forex-bot/contracts";

export interface HotCache {
  setLatestTick(t: Tick): Promise<void>;
  getLatestTick(symbol: Symbol): Promise<Tick | undefined>;

  /** Keep a rolling window of recent headlines (default 24h). */
  pushHeadline(h: NewsHeadline): Promise<void>;
  recentHeadlines(opts: { sinceMs: number; max?: number }): Promise<readonly NewsHeadline[]>;

  /** Replace the active calendar window (e.g. next 48h). */
  setCalendarWindow(events: readonly CalendarEvent[]): Promise<void>;
  getCalendarWindow(): Promise<readonly CalendarEvent[]>;

  setAccountSnapshot(s: AccountState): Promise<void>;
  getAccountSnapshot(): Promise<AccountState | undefined>;
}
```

- [ ] **Step 6: Write `packages/data-core/src/index.ts`**

```ts
export * from "./adapters.js";
export * from "./cache.js";
export * from "./memory.js";
```

- [ ] **Step 7: Install + typecheck**

Run: `pnpm install && pnpm --filter @forex-bot/data-core typecheck`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/data-core pnpm-lock.yaml
git commit -m "feat(data-core): define adapter, memory, and cache interfaces"
```

---

## Task 2: `data-core` — in-memory fakes + tests

**Files:**
- Create: `packages/data-core/src/fakes.ts`, `packages/data-core/test/fakes.test.ts`
- Modify: `packages/data-core/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/data-core/test/fakes.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  FakeEmbeddingProvider,
  InMemoryHotCache,
  InMemoryJournalStore,
  InMemoryRagStore,
} from "../src/fakes.js";

describe("FakeEmbeddingProvider", () => {
  it("returns vectors of declared dimension and is deterministic", async () => {
    const e = new FakeEmbeddingProvider({ dimension: 8, modelVersion: "fake-v1" });
    const [a, b] = await e.embed(["hello", "hello"]);
    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
  });

  it("identical inputs → identical vectors; different inputs → different vectors", async () => {
    const e = new FakeEmbeddingProvider({ dimension: 4, modelVersion: "fake-v1" });
    const [a, b] = await e.embed(["foo", "bar"]);
    expect(a).not.toEqual(b);
  });
});

describe("InMemoryJournalStore", () => {
  it("round-trips a TradeJournal", async () => {
    const s = new InMemoryJournalStore();
    const j = {
      tradeId: "t-1",
      symbol: "EURUSD" as const,
      openedAt: 1,
      verdict: { direction: "long" as const, confidence: 0.8, horizon: "H1" as const, reasoning: "x" },
      risk: { approve: true as const, lotSize: 0.1, sl: 1.07, tp: 1.09, expiresAt: 2, reasons: ["ok"] },
    };
    await s.put(j);
    expect((await s.get("t-1"))?.tradeId).toBe("t-1");
    expect(await s.get("missing")).toBeUndefined();
  });

  it("list returns newest-first and paginates with cursor", async () => {
    const s = new InMemoryJournalStore();
    for (let i = 0; i < 5; i++) {
      await s.put({
        tradeId: `t-${i}`,
        symbol: "EURUSD",
        openedAt: i * 1000,
        verdict: { direction: "long", confidence: 0.5, horizon: "H1", reasoning: "x" },
        risk: { approve: true, lotSize: 0.1, sl: 1.07, tp: 1.09, expiresAt: 0, reasons: ["ok"] },
      });
    }
    const page1 = await s.list({ limit: 2 });
    expect(page1.items.map((j) => j.tradeId)).toEqual(["t-4", "t-3"]);
    const page2 = await s.list({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((j) => j.tradeId)).toEqual(["t-2", "t-1"]);
  });
});

describe("InMemoryRagStore", () => {
  it("returns top-K by cosine similarity", async () => {
    const s = new InMemoryRagStore();
    await s.put({ id: "a", text: "a", embedding: [1, 0, 0], modelVersion: "v1", metadata: {}, ts: 1 });
    await s.put({ id: "b", text: "b", embedding: [0, 1, 0], modelVersion: "v1", metadata: {}, ts: 2 });
    await s.put({ id: "c", text: "c", embedding: [0.9, 0.1, 0], modelVersion: "v1", metadata: {}, ts: 3 });
    const out = await s.search({ embedding: [1, 0, 0], k: 2 });
    expect(out.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("supports metadata exact-match filters", async () => {
    const s = new InMemoryRagStore();
    await s.put({ id: "a", text: "a", embedding: [1, 0], modelVersion: "v1", metadata: { regime: "trending" }, ts: 1 });
    await s.put({ id: "b", text: "b", embedding: [1, 0], modelVersion: "v1", metadata: { regime: "ranging" }, ts: 2 });
    const out = await s.search({ embedding: [1, 0], k: 5, filter: { regime: "trending" } });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("InMemoryHotCache", () => {
  it("stores latest tick per symbol", async () => {
    const c = new InMemoryHotCache();
    await c.setLatestTick({ ts: 1, symbol: "EURUSD", bid: 1.08, ask: 1.0801 });
    await c.setLatestTick({ ts: 2, symbol: "EURUSD", bid: 1.0805, ask: 1.0806 });
    expect((await c.getLatestTick("EURUSD"))?.bid).toBe(1.0805);
  });

  it("recentHeadlines drops items older than sinceMs", async () => {
    const c = new InMemoryHotCache();
    await c.pushHeadline({ ts: 1, source: "x", title: "old" });
    await c.pushHeadline({ ts: 100, source: "x", title: "new" });
    expect((await c.recentHeadlines({ sinceMs: 50 })).map((h) => h.title)).toEqual(["new"]);
  });

  it("setCalendarWindow replaces wholesale", async () => {
    const c = new InMemoryHotCache();
    await c.setCalendarWindow([{ ts: 1, currency: "USD", impact: "high", title: "CPI" }]);
    await c.setCalendarWindow([{ ts: 2, currency: "EUR", impact: "low", title: "PMI" }]);
    const w = await c.getCalendarWindow();
    expect(w.map((e) => e.currency)).toEqual(["EUR"]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm vitest run packages/data-core/test/fakes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/data-core/src/fakes.ts`**

```ts
import type {
  AccountState,
  CalendarEvent,
  NewsHeadline,
  Symbol,
  Tick,
  TradeJournal,
} from "@forex-bot/contracts";
import type { HotCache } from "./cache.js";
import type { EmbeddingProvider, JournalStore, RagDoc, RagStore } from "./memory.js";

export interface FakeEmbeddingProviderOptions {
  dimension: number;
  modelVersion: string;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  readonly modelVersion: string;

  constructor(opts: FakeEmbeddingProviderOptions) {
    this.dimension = opts.dimension;
    this.modelVersion = opts.modelVersion;
  }

  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map((t) => this.hashVector(t));
  }

  private hashVector(text: string): number[] {
    // Deterministic pseudo-random vector seeded by text. Not for production.
    const out = new Array<number>(this.dimension).fill(0);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    for (let i = 0; i < this.dimension; i++) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
      out[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    return out;
  }
}

export class InMemoryJournalStore implements JournalStore {
  private readonly byId = new Map<string, TradeJournal>();

  async put(j: TradeJournal): Promise<void> {
    this.byId.set(j.tradeId, { ...j });
  }

  async get(tradeId: string): Promise<TradeJournal | undefined> {
    return this.byId.get(tradeId);
  }

  async list({ limit, cursor }: { limit: number; cursor?: string }): Promise<{
    items: readonly TradeJournal[];
    nextCursor?: string;
  }> {
    const sorted = [...this.byId.values()].sort((a, b) => b.openedAt - a.openedAt);
    const startIdx = cursor ? Number(cursor) : 0;
    const end = startIdx + limit;
    const items = sorted.slice(startIdx, end);
    const nextCursor = end < sorted.length ? String(end) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  }
}

export class InMemoryRagStore implements RagStore {
  private readonly docs = new Map<string, RagDoc>();

  async put(doc: RagDoc): Promise<void> {
    this.docs.set(doc.id, { ...doc, embedding: [...doc.embedding] });
  }

  async search(query: {
    embedding: readonly number[];
    k: number;
    filter?: Record<string, string>;
  }): Promise<readonly RagDoc[]> {
    const candidates = [...this.docs.values()].filter((d) => {
      if (!query.filter) return true;
      return Object.entries(query.filter).every(([k, v]) => d.metadata[k] === v);
    });
    const scored = candidates.map((d) => ({ d, score: cosine(query.embedding, d.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, query.k).map((s) => s.d);
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error("dimension mismatch");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class InMemoryHotCache implements HotCache {
  private readonly ticks = new Map<Symbol, Tick>();
  private readonly headlines: NewsHeadline[] = [];
  private calendar: CalendarEvent[] = [];
  private account?: AccountState;

  async setLatestTick(t: Tick): Promise<void> {
    this.ticks.set(t.symbol, t);
  }

  async getLatestTick(symbol: Symbol): Promise<Tick | undefined> {
    return this.ticks.get(symbol);
  }

  async pushHeadline(h: NewsHeadline): Promise<void> {
    this.headlines.push(h);
  }

  async recentHeadlines({ sinceMs, max }: { sinceMs: number; max?: number }): Promise<readonly NewsHeadline[]> {
    const filtered = this.headlines.filter((h) => h.ts >= sinceMs);
    return max ? filtered.slice(-max) : filtered;
  }

  async setCalendarWindow(events: readonly CalendarEvent[]): Promise<void> {
    this.calendar = [...events];
  }

  async getCalendarWindow(): Promise<readonly CalendarEvent[]> {
    return [...this.calendar];
  }

  async setAccountSnapshot(s: AccountState): Promise<void> {
    this.account = { ...s };
  }

  async getAccountSnapshot(): Promise<AccountState | undefined> {
    return this.account;
  }
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./adapters.js";
export * from "./cache.js";
export * from "./memory.js";
export * from "./fakes.js";
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/data-core/test/fakes.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/data-core
git commit -m "feat(data-core): add in-memory fakes for embedding/journal/RAG/cache"
```

---

## Task 3: `news-rss` adapter

**Files:**
- Create: `packages/news-rss/{package.json,tsconfig.json,src/{rss-adapter.ts,index.ts},test/rss-adapter.test.ts}`

- [ ] **Step 1: Write `packages/news-rss/package.json`**

```json
{
  "name": "@forex-bot/news-rss",
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
    "rss-parser": "^3.13.0"
  }
}
```

- [ ] **Step 2: Write `packages/news-rss/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "compilerOptions": { "rootDir": "." }
}
```

- [ ] **Step 3: Write the failing test `packages/news-rss/test/rss-adapter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { RssNewsAdapter } from "../src/rss-adapter.js";

const SAMPLE_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Sample Feed</title>
  <item>
    <title>Fed holds rates</title>
    <link>https://example/fed1</link>
    <pubDate>Tue, 01 Apr 2025 12:00:00 GMT</pubDate>
    <description>Description text</description>
  </item>
  <item>
    <title>ECB hints at cut</title>
    <link>https://example/ecb1</link>
    <pubDate>Tue, 01 Apr 2025 14:00:00 GMT</pubDate>
    <description>Another description</description>
  </item>
</channel></rss>`;

describe("RssNewsAdapter", () => {
  it("parses a feed and returns NewsHeadline items", async () => {
    const adapter = new RssNewsAdapter({
      source: "test-rss",
      feedUrl: "https://example/feed.rss",
      fetcher: async () => SAMPLE_FEED,
    });
    const items = await adapter.fetch({ since: 0 });
    expect(items).toHaveLength(2);
    const titles = items.map((i) => i.title);
    expect(titles).toContain("Fed holds rates");
  });

  it("filters items by `since`", async () => {
    const adapter = new RssNewsAdapter({
      source: "test-rss",
      feedUrl: "https://example/feed.rss",
      fetcher: async () => SAMPLE_FEED,
    });
    // 2025-04-01 13:00 UTC → keeps only ECB
    const since = Date.UTC(2025, 3, 1, 13, 0, 0);
    const items = await adapter.fetch({ since });
    expect(items.map((i) => i.title)).toEqual(["ECB hints at cut"]);
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/news-rss/test/rss-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 5: Write `packages/news-rss/src/rss-adapter.ts`**

```ts
import type { NewsHeadline } from "@forex-bot/contracts";
import type { FetchWindow, NewsAdapter } from "@forex-bot/data-core";
import Parser from "rss-parser";

export interface RssNewsAdapterOptions {
  source: string;
  feedUrl: string;
  /** Inject a fetcher for tests; defaults to global fetch. */
  fetcher?: (url: string) => Promise<string>;
}

export class RssNewsAdapter implements NewsAdapter {
  readonly source: string;
  private readonly feedUrl: string;
  private readonly fetcher: (url: string) => Promise<string>;
  private readonly parser = new Parser();

  constructor(opts: RssNewsAdapterOptions) {
    this.source = opts.source;
    this.feedUrl = opts.feedUrl;
    this.fetcher = opts.fetcher ?? (async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`RSS ${u} failed: ${r.status}`);
      return r.text();
    });
  }

  async fetch(window: FetchWindow): Promise<readonly NewsHeadline[]> {
    const xml = await this.fetcher(this.feedUrl);
    const parsed = await this.parser.parseString(xml);
    const out: NewsHeadline[] = [];
    for (const item of parsed.items ?? []) {
      const ts = item.isoDate ? Date.parse(item.isoDate) : item.pubDate ? Date.parse(item.pubDate) : 0;
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      out.push({
        ts,
        source: this.source,
        title: item.title?.trim() ?? "",
        ...(item.contentSnippet ? { summary: item.contentSnippet.trim() } : {}),
      });
    }
    return out;
  }
}
```

- [ ] **Step 6: Write `packages/news-rss/src/index.ts`**

```ts
export * from "./rss-adapter.js";
```

- [ ] **Step 7: Install + run tests**

Run: `pnpm install && pnpm vitest run packages/news-rss/test/rss-adapter.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/news-rss pnpm-lock.yaml
git commit -m "feat(news-rss): add RSS NewsAdapter with injectable fetcher"
```

---

## Task 4: `news-api` adapter (HTTP)

**Files:**
- Create: `packages/news-api/{package.json,tsconfig.json,src/{newsapi-adapter.ts,index.ts},test/newsapi-adapter.test.ts}`

- [ ] **Step 1: Write `packages/news-api/package.json`**

```json
{
  "name": "@forex-bot/news-api",
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
    "@forex-bot/data-core": "workspace:*"
  }
}
```

- [ ] **Step 2: Write `packages/news-api/tsconfig.json`**

(same as Task 3 step 2)

- [ ] **Step 3: Write the failing test `packages/news-api/test/newsapi-adapter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { NewsApiAdapter } from "../src/newsapi-adapter.js";

const SAMPLE = {
  status: "ok",
  totalResults: 2,
  articles: [
    {
      source: { id: null, name: "Reuters" },
      author: "Foo",
      title: "Fed holds rates steady",
      description: "Summary",
      url: "https://example/a1",
      publishedAt: "2025-04-01T12:00:00Z",
      content: "...",
    },
    {
      source: { id: null, name: "FT" },
      author: "Bar",
      title: "ECB hints at cut",
      description: "Summary 2",
      url: "https://example/a2",
      publishedAt: "2025-04-01T14:00:00Z",
      content: "...",
    },
  ],
};

describe("NewsApiAdapter", () => {
  it("calls newsapi with apiKey + q and parses articles", async () => {
    const calls: string[] = [];
    const adapter = new NewsApiAdapter({
      apiKey: "k",
      query: "forex OR EURUSD",
      fetcher: async (url) => {
        calls.push(url);
        return SAMPLE;
      },
    });
    const out = await adapter.fetch({ since: 0 });
    expect(out).toHaveLength(2);
    expect(calls[0]).toContain("apiKey=k");
    expect(decodeURIComponent(calls[0] ?? "")).toContain("forex OR EURUSD");
  });

  it("filters by since", async () => {
    const adapter = new NewsApiAdapter({
      apiKey: "k",
      query: "forex",
      fetcher: async () => SAMPLE,
    });
    const out = await adapter.fetch({ since: Date.UTC(2025, 3, 1, 13, 0) });
    expect(out.map((h) => h.title)).toEqual(["ECB hints at cut"]);
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/news-api/test/newsapi-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 5: Write `packages/news-api/src/newsapi-adapter.ts`**

```ts
import type { NewsHeadline } from "@forex-bot/contracts";
import type { FetchWindow, NewsAdapter } from "@forex-bot/data-core";

interface NewsApiArticle {
  source: { name: string };
  title: string;
  description?: string;
  publishedAt: string;
}

interface NewsApiResponse {
  status: string;
  articles: readonly NewsApiArticle[];
}

export interface NewsApiAdapterOptions {
  apiKey: string;
  query: string;
  /** Inject a fetcher for tests. Default uses fetch + JSON parse. */
  fetcher?: (url: string) => Promise<NewsApiResponse>;
}

export class NewsApiAdapter implements NewsAdapter {
  readonly source = "newsapi";
  private readonly apiKey: string;
  private readonly query: string;
  private readonly fetcher: (url: string) => Promise<NewsApiResponse>;

  constructor(opts: NewsApiAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.query = opts.query;
    this.fetcher = opts.fetcher ?? (async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`NewsAPI ${u} failed: ${r.status}`);
      return (await r.json()) as NewsApiResponse;
    });
  }

  async fetch(window: FetchWindow): Promise<readonly NewsHeadline[]> {
    const url =
      `https://newsapi.org/v2/everything` +
      `?apiKey=${encodeURIComponent(this.apiKey)}` +
      `&q=${encodeURIComponent(this.query)}` +
      `&from=${new Date(window.since).toISOString()}` +
      `&sortBy=publishedAt`;
    const json = await this.fetcher(url);
    if (json.status !== "ok") throw new Error(`NewsAPI returned status: ${json.status}`);
    const out: NewsHeadline[] = [];
    for (const a of json.articles) {
      const ts = Date.parse(a.publishedAt);
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      out.push({
        ts,
        source: `newsapi:${a.source.name}`,
        title: a.title,
        ...(a.description ? { summary: a.description } : {}),
      });
    }
    return out;
  }
}
```

- [ ] **Step 6: Write `packages/news-api/src/index.ts`**

```ts
export * from "./newsapi-adapter.js";
```

- [ ] **Step 7: Run test**

Run: `pnpm vitest run packages/news-api/test/newsapi-adapter.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/news-api
git commit -m "feat(news-api): add NewsAPI adapter with injectable fetcher"
```

---

## Task 5: `calendar-forexfactory` adapter

**Files:**
- Create: `packages/calendar-forexfactory/{package.json,tsconfig.json,src/{ff-adapter.ts,index.ts},test/ff-adapter.test.ts}`

ForexFactory publishes a weekly calendar JSON at `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (publicly available; the URL is a stable convention even though the host is informal). We treat the URL as injectable so tests don't hit the network.

- [ ] **Step 1: Write `packages/calendar-forexfactory/package.json`**

```json
{
  "name": "@forex-bot/calendar-forexfactory",
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
    "@forex-bot/data-core": "workspace:*"
  }
}
```

- [ ] **Step 2: Write tsconfig** (same template)

- [ ] **Step 3: Write the failing test `packages/calendar-forexfactory/test/ff-adapter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ForexFactoryCalendarAdapter } from "../src/ff-adapter.js";

const SAMPLE = [
  {
    title: "Non-Farm Employment Change",
    country: "USD",
    date: "2025-04-04T12:30:00Z",
    impact: "High",
    forecast: "200K",
    previous: "150K",
    actual: "",
  },
  {
    title: "ECB Rate Decision",
    country: "EUR",
    date: "2025-04-10T11:45:00Z",
    impact: "High",
    forecast: "3.50%",
    previous: "3.50%",
    actual: "",
  },
  {
    title: "Bank Holiday",
    country: "JPY",
    date: "2025-04-29T00:00:00Z",
    impact: "Holiday",
    forecast: "",
    previous: "",
    actual: "",
  },
];

describe("ForexFactoryCalendarAdapter", () => {
  it("maps impact + currency and skips holidays", async () => {
    const adapter = new ForexFactoryCalendarAdapter({ fetcher: async () => SAMPLE });
    const out = await adapter.fetch({ since: 0 });
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.impact !== "low" || e.currency === "EUR")).toBe(true);
    const nfp = out.find((e) => e.title.includes("Non-Farm"));
    expect(nfp?.currency).toBe("USD");
    expect(nfp?.impact).toBe("high");
  });

  it("filters by since", async () => {
    const adapter = new ForexFactoryCalendarAdapter({ fetcher: async () => SAMPLE });
    const out = await adapter.fetch({ since: Date.UTC(2025, 3, 5) });
    expect(out.map((e) => e.title)).toContain("ECB Rate Decision");
    expect(out.map((e) => e.title)).not.toContain("Non-Farm Employment Change");
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run packages/calendar-forexfactory/test/ff-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 5: Write `packages/calendar-forexfactory/src/ff-adapter.ts`**

```ts
import type { CalendarEvent } from "@forex-bot/contracts";
import type { CalendarAdapter, FetchWindow } from "@forex-bot/data-core";

interface FfRow {
  title: string;
  country: string;        // 3-letter currency code
  date: string;           // ISO 8601
  impact: "High" | "Medium" | "Low" | "Holiday" | string;
  forecast: string;
  previous: string;
  actual: string;
}

export interface ForexFactoryCalendarAdapterOptions {
  url?: string;
  fetcher?: (url: string) => Promise<readonly FfRow[]>;
}

const DEFAULT_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export class ForexFactoryCalendarAdapter implements CalendarAdapter {
  readonly source = "forexfactory";
  private readonly url: string;
  private readonly fetcher: (url: string) => Promise<readonly FfRow[]>;

  constructor(opts: ForexFactoryCalendarAdapterOptions = {}) {
    this.url = opts.url ?? DEFAULT_URL;
    this.fetcher = opts.fetcher ?? (async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`ForexFactory ${u} failed: ${r.status}`);
      return (await r.json()) as readonly FfRow[];
    });
  }

  async fetch(window: FetchWindow): Promise<readonly CalendarEvent[]> {
    const rows = await this.fetcher(this.url);
    const out: CalendarEvent[] = [];
    for (const r of rows) {
      const ts = Date.parse(r.date);
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      const impact = mapImpact(r.impact);
      if (!impact) continue; // skip Holiday and unknowns
      if (!/^[A-Z]{3}$/.test(r.country)) continue;
      out.push({
        ts,
        currency: r.country,
        impact,
        title: r.title,
        ...(r.forecast ? { forecast: parseNumeric(r.forecast) } : {}),
        ...(r.previous ? { previous: parseNumeric(r.previous) } : {}),
        ...(r.actual ? { actual: parseNumeric(r.actual) } : {}),
      });
    }
    return out;
  }
}

function mapImpact(raw: string): "low" | "medium" | "high" | undefined {
  switch (raw) {
    case "High": return "high";
    case "Medium": return "medium";
    case "Low": return "low";
    default: return undefined;
  }
}

function parseNumeric(raw: string): number | undefined {
  const cleaned = raw.replace(/[%KkMm$]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}
```

> `parseNumeric` is intentionally lossy — units are stripped. The numeric value is a hint for the analysts; the canonical field is `title`.

- [ ] **Step 6: Write `packages/calendar-forexfactory/src/index.ts`**

```ts
export * from "./ff-adapter.js";
```

- [ ] **Step 7: Run test**

Run: `pnpm vitest run packages/calendar-forexfactory/test/ff-adapter.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/calendar-forexfactory
git commit -m "feat(calendar): add ForexFactory CalendarAdapter"
```

---

## Task 6: `cb-scrapers` — Fed press releases

**Files:**
- Create: `packages/cb-scrapers/{package.json,tsconfig.json,src/{fed-press.ts,types.ts,index.ts},test/fed-press.test.ts}`

The Fed publishes press releases at `https://www.federalreserve.gov/feeds/press_all.xml` (RSS). We model only this one as a baseline; ECB/BoE/BoJ/SNB/RBA/RBNZ are mechanical clones and explicitly out of scope for this plan.

- [ ] **Step 1: Write `packages/cb-scrapers/package.json`**

```json
{
  "name": "@forex-bot/cb-scrapers",
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
    "linkedom": "^0.18.5",
    "rss-parser": "^3.13.0"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template)

- [ ] **Step 3: Write `packages/cb-scrapers/src/types.ts`**

```ts
export const CB_BANKS = ["FED", "ECB", "BOE", "BOJ", "SNB", "RBA", "RBNZ"] as const;
export type CbBank = (typeof CB_BANKS)[number];
```

- [ ] **Step 4: Write the failing test `packages/cb-scrapers/test/fed-press.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { FedPressAdapter } from "../src/fed-press.js";

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>FOMC statement: rates unchanged</title>
    <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20250320a.htm</link>
    <pubDate>Wed, 20 Mar 2025 18:00:00 GMT</pubDate>
    <description>FOMC press release.</description>
  </item>
</channel></rss>`;

const PAGE = `<!doctype html><html><body>
  <div class="article">
    <p>The Federal Open Market Committee decided today to maintain the target range...</p>
    <p>In assessing the appropriate stance...</p>
  </div>
</body></html>`;

describe("FedPressAdapter", () => {
  it("emits a CbDocument with normalized body text", async () => {
    const adapter = new FedPressAdapter({
      feedFetcher: async () => FEED,
      pageFetcher: async () => PAGE,
    });
    const docs = await adapter.fetch({ since: 0 });
    expect(docs).toHaveLength(1);
    const d = docs[0];
    expect(d?.bank).toBe("FED");
    expect(d?.kind).toBe("press_release");
    expect(d?.body).toContain("Federal Open Market Committee");
    expect(d?.body).not.toContain("<p>");
  });
});
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/cb-scrapers/test/fed-press.test.ts`
Expected: FAIL.

- [ ] **Step 6: Write `packages/cb-scrapers/src/fed-press.ts`**

```ts
import type { CbAdapter, CbDocument, FetchWindow } from "@forex-bot/data-core";
import { parseHTML } from "linkedom";
import Parser from "rss-parser";

const FEED_URL = "https://www.federalreserve.gov/feeds/press_all.xml";

export interface FedPressAdapterOptions {
  feedUrl?: string;
  feedFetcher?: (url: string) => Promise<string>;
  pageFetcher?: (url: string) => Promise<string>;
}

export class FedPressAdapter implements CbAdapter {
  readonly source = "fed-press";
  private readonly feedUrl: string;
  private readonly feedFetcher: (url: string) => Promise<string>;
  private readonly pageFetcher: (url: string) => Promise<string>;
  private readonly parser = new Parser();

  constructor(opts: FedPressAdapterOptions = {}) {
    this.feedUrl = opts.feedUrl ?? FEED_URL;
    this.feedFetcher = opts.feedFetcher ?? defaultTextFetch;
    this.pageFetcher = opts.pageFetcher ?? defaultTextFetch;
  }

  async fetch(window: FetchWindow): Promise<readonly CbDocument[]> {
    const xml = await this.feedFetcher(this.feedUrl);
    const parsed = await this.parser.parseString(xml);
    const out: CbDocument[] = [];
    for (const item of parsed.items ?? []) {
      const ts = item.isoDate ? Date.parse(item.isoDate) : item.pubDate ? Date.parse(item.pubDate) : 0;
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      const url = item.link ?? "";
      const body = url ? extractText(await this.pageFetcher(url)) : "";
      out.push({
        ts,
        bank: "FED",
        kind: "press_release",
        title: item.title?.trim() ?? "",
        url,
        body,
      });
    }
    return out;
  }
}

async function defaultTextFetch(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} failed: ${r.status}`);
  return r.text();
}

function extractText(html: string): string {
  const { document } = parseHTML(html);
  const article = document.querySelector(".article") ?? document.body;
  if (!article) return "";
  return Array.from(article.querySelectorAll("p"))
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 7: Write `packages/cb-scrapers/src/index.ts`**

```ts
export * from "./fed-press.js";
export * from "./types.js";
```

- [ ] **Step 8: Run test**

Run: `pnpm install && pnpm vitest run packages/cb-scrapers/test/fed-press.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/cb-scrapers pnpm-lock.yaml
git commit -m "feat(cb-scrapers): add Fed press release adapter (RSS + body extract)"
```

---

## Task 7: `cot` — CFTC report adapter

**Files:**
- Create: `packages/cot/{package.json,tsconfig.json,src/{cftc-adapter.ts,index.ts},test/cftc-adapter.test.ts}`

CFTC publishes COT reports as text files at predictable URLs. Real-world parsing of CFTC text is tedious (long fixed-width files); for v1 we accept a pre-parsed JSON shape from the fetcher and leave the wire-format adapter for a future task.

- [ ] **Step 1: Write `packages/cot/package.json`**

```json
{
  "name": "@forex-bot/cot",
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
    "@forex-bot/data-core": "workspace:*"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template)

- [ ] **Step 3: Write the failing test `packages/cot/test/cftc-adapter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { CftcCotAdapter } from "../src/cftc-adapter.js";

const SAMPLE = [
  {
    ts: Date.UTC(2025, 3, 4, 19, 30),
    contract: "EURO FX",
    netNonCommercial: 100_000,
    netCommercial: -120_000,
    weeklyChangeNonCommercial: 5_000,
  },
  {
    ts: Date.UTC(2025, 3, 4, 19, 30),
    contract: "BRITISH POUND",
    netNonCommercial: 50_000,
    netCommercial: -60_000,
    weeklyChangeNonCommercial: -2_000,
  },
];

describe("CftcCotAdapter", () => {
  it("maps CFTC contract names to symbols", async () => {
    const a = new CftcCotAdapter({ fetcher: async () => SAMPLE });
    const out = await a.fetch({ since: 0 });
    expect(out.find((r) => r.symbol === "EURUSD")?.netNonCommercial).toBe(100_000);
    expect(out.find((r) => r.symbol === "GBPUSD")).toBeDefined();
  });

  it("skips contracts without a known symbol mapping", async () => {
    const a = new CftcCotAdapter({
      fetcher: async () => [{ ...SAMPLE[0], contract: "MYSTERY" } as any],
    });
    expect(await a.fetch({ since: 0 })).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test**

Expected: FAIL.

- [ ] **Step 5: Write `packages/cot/src/cftc-adapter.ts`**

```ts
import type { Symbol } from "@forex-bot/contracts";
import type { CotAdapter, CotReport, FetchWindow } from "@forex-bot/data-core";

export interface CftcRawRow {
  ts: number;
  contract: string;
  netNonCommercial: number;
  netCommercial: number;
  weeklyChangeNonCommercial: number;
}

export interface CftcCotAdapterOptions {
  fetcher: () => Promise<readonly CftcRawRow[]>;
}

const CONTRACT_TO_SYMBOL: Record<string, Symbol> = {
  "EURO FX": "EURUSD",
  "BRITISH POUND": "GBPUSD",
  "JAPANESE YEN": "USDJPY",
  "AUSTRALIAN DOLLAR": "AUDUSD",
  "NEW ZEALAND DOLLAR": "NZDUSD",
  "CANADIAN DOLLAR": "USDCAD",
  "SWISS FRANC": "USDCHF",
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
};

export class CftcCotAdapter implements CotAdapter {
  readonly source = "cftc-cot";
  private readonly fetcher: () => Promise<readonly CftcRawRow[]>;

  constructor(opts: CftcCotAdapterOptions) {
    this.fetcher = opts.fetcher;
  }

  async fetch(window: FetchWindow): Promise<readonly CotReport[]> {
    const rows = await this.fetcher();
    const out: CotReport[] = [];
    for (const r of rows) {
      if (r.ts < window.since) continue;
      if (window.until !== undefined && r.ts > window.until) continue;
      const symbol = CONTRACT_TO_SYMBOL[r.contract];
      if (!symbol) continue;
      out.push({
        ts: r.ts,
        symbol,
        netNonCommercial: r.netNonCommercial,
        netCommercial: r.netCommercial,
        changeWeekly: r.weeklyChangeNonCommercial,
      });
    }
    return out;
  }
}
```

- [ ] **Step 6: Write `packages/cot/src/index.ts`**

```ts
export * from "./cftc-adapter.js";
```

- [ ] **Step 7: Run test**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cot
git commit -m "feat(cot): add CFTC adapter mapping contracts to symbols"
```

---

## Task 8: `memory` — package scaffold + types

**Files:**
- Create: `packages/memory/{package.json,tsconfig.json,src/{index.ts}}`

- [ ] **Step 1: Write `packages/memory/package.json`**

```json
{
  "name": "@forex-bot/memory",
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
    "@aws-sdk/client-dynamodb": "^3.690.0",
    "@aws-sdk/lib-dynamodb": "^3.690.0",
    "@forex-bot/contracts": "workspace:*",
    "@forex-bot/data-core": "workspace:*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template)

- [ ] **Step 3: Write `packages/memory/src/index.ts`** (placeholder; concrete clients come in Tasks 9-10)

```ts
// Concrete JournalStore + RagStore implementations live in Tasks 9/10.
export {};
```

- [ ] **Step 4: Install + typecheck**

Run: `pnpm install && pnpm --filter @forex-bot/memory typecheck`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/memory pnpm-lock.yaml
git commit -m "feat(memory): scaffold package with pg + dynamodb deps"
```

---

## Task 9: `memory` — pgvector RagStore

**Files:**
- Create: `packages/memory/src/pgvector-rag.ts`, `packages/memory/test/pgvector-rag.integration.test.ts`, `packages/memory/migrations/001_rag_docs.sql`
- Modify: `packages/memory/src/index.ts`

This task ships an integration test that **requires** Postgres + pgvector. It self-skips when `PG_TEST_URL` is unset, so unit-test runs (`pnpm test`) are unaffected. CI sets `PG_TEST_URL` from docker compose (Task 18).

- [ ] **Step 1: Write `packages/memory/migrations/001_rag_docs.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_docs (
  id            text PRIMARY KEY,
  text          text NOT NULL,
  embedding     vector NOT NULL,
  model_version text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts            bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS rag_docs_embedding_idx
  ON rag_docs
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE INDEX IF NOT EXISTS rag_docs_metadata_idx ON rag_docs USING GIN (metadata);
```

- [ ] **Step 2: Write the failing integration test `packages/memory/test/pgvector-rag.integration.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RagDoc } from "@forex-bot/data-core";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgvectorRagStore } from "../src/pgvector-rag.js";

const PG_URL = process.env.PG_TEST_URL;
const __dirname = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!PG_URL)("PgvectorRagStore (integration)", () => {
  let client: Client;
  let store: PgvectorRagStore;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_URL });
    await client.connect();
    const sql = readFileSync(resolve(__dirname, "../migrations/001_rag_docs.sql"), "utf8");
    await client.query(sql);
    await client.query("TRUNCATE rag_docs");
    store = new PgvectorRagStore({ connectionString: PG_URL!, dimension: 3 });
    await store.connect();
  });

  afterAll(async () => {
    await store.close();
    await client.end();
  });

  it("put + search returns top-k by cosine similarity", async () => {
    const docs: RagDoc[] = [
      { id: "a", text: "a", embedding: [1, 0, 0], modelVersion: "v1", metadata: { regime: "trending" }, ts: 1 },
      { id: "b", text: "b", embedding: [0, 1, 0], modelVersion: "v1", metadata: { regime: "ranging" }, ts: 2 },
      { id: "c", text: "c", embedding: [0.9, 0.1, 0], modelVersion: "v1", metadata: { regime: "trending" }, ts: 3 },
    ];
    for (const d of docs) await store.put(d);
    const out = await store.search({ embedding: [1, 0, 0], k: 2 });
    expect(out.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("filters by metadata", async () => {
    const out = await store.search({ embedding: [1, 0, 0], k: 5, filter: { regime: "ranging" } });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 3: Run the test (skipped without PG_TEST_URL)**

Run: `pnpm vitest run packages/memory/test/pgvector-rag.integration.test.ts`
Expected: 1 test file with 0 tests run (suite skipped).

- [ ] **Step 4: Write `packages/memory/src/pgvector-rag.ts`**

```ts
import type { RagDoc, RagStore } from "@forex-bot/data-core";
import { Client } from "pg";

export interface PgvectorRagStoreOptions {
  connectionString: string;
  dimension: number;
}

export class PgvectorRagStore implements RagStore {
  private readonly client: Client;
  private readonly dimension: number;
  private connected = false;

  constructor(opts: PgvectorRagStoreOptions) {
    this.client = new Client({ connectionString: opts.connectionString });
    this.dimension = opts.dimension;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.end();
    this.connected = false;
  }

  async put(doc: RagDoc): Promise<void> {
    if (doc.embedding.length !== this.dimension) {
      throw new Error(`embedding length ${doc.embedding.length} != configured ${this.dimension}`);
    }
    await this.client.query(
      `INSERT INTO rag_docs (id, text, embedding, model_version, metadata, ts)
       VALUES ($1, $2, $3::vector, $4, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE
         SET text = EXCLUDED.text,
             embedding = EXCLUDED.embedding,
             model_version = EXCLUDED.model_version,
             metadata = EXCLUDED.metadata,
             ts = EXCLUDED.ts`,
      [
        doc.id,
        doc.text,
        toVectorLiteral(doc.embedding),
        doc.modelVersion,
        JSON.stringify(doc.metadata),
        doc.ts,
      ],
    );
  }

  async search(query: {
    embedding: readonly number[];
    k: number;
    filter?: Record<string, string>;
  }): Promise<readonly RagDoc[]> {
    if (query.embedding.length !== this.dimension) {
      throw new Error(`query embedding length ${query.embedding.length} != configured ${this.dimension}`);
    }
    const params: unknown[] = [toVectorLiteral(query.embedding), query.k];
    let filterSql = "";
    if (query.filter && Object.keys(query.filter).length > 0) {
      filterSql = `WHERE metadata @> $3::jsonb`;
      params.push(JSON.stringify(query.filter));
    }
    const sql = `
      SELECT id, text, embedding::text AS embedding, model_version, metadata, ts
      FROM rag_docs
      ${filterSql}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const result = await this.client.query(sql, params);
    return result.rows.map((r) => ({
      id: String(r.id),
      text: String(r.text),
      embedding: parseVectorLiteral(String(r.embedding)),
      modelVersion: String(r.model_version),
      metadata: r.metadata ?? {},
      ts: Number(r.ts),
    }));
  }
}

function toVectorLiteral(v: readonly number[]): string {
  return `[${v.join(",")}]`;
}

function parseVectorLiteral(s: string): number[] {
  // pgvector text format: "[1,2,3]"
  const trimmed = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  return trimmed === "" ? [] : trimmed.split(",").map((x) => Number(x));
}
```

- [ ] **Step 5: Update `packages/memory/src/index.ts`**

```ts
export * from "./pgvector-rag.js";
```

- [ ] **Step 6: Re-run the integration test (still skipped without PG)**

Run: `pnpm vitest run packages/memory/test/pgvector-rag.integration.test.ts`
Expected: 0 tests run.

> Full validation lands in Task 18 once docker compose ships PG_TEST_URL. Until then `pnpm typecheck` is the only guarantee.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @forex-bot/memory typecheck`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): add PgvectorRagStore (integration test gated on PG_TEST_URL)"
```

---

## Task 10: `memory` — DynamoDB JournalStore

**Files:**
- Create: `packages/memory/src/dynamo-journal.ts`, `packages/memory/test/dynamo-journal.integration.test.ts`
- Modify: `packages/memory/src/index.ts`

Same skip-without-env pattern as Task 9. `DYNAMO_TEST_ENDPOINT` is consumed; CI provides it via dynamodb-local in Task 18.

- [ ] **Step 1: Write the failing test `packages/memory/test/dynamo-journal.integration.test.ts`**

```ts
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { TradeJournal } from "@forex-bot/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DynamoJournalStore } from "../src/dynamo-journal.js";

const ENDPOINT = process.env.DYNAMO_TEST_ENDPOINT;
const TABLE = "forex_bot_journal_test";

describe.skipIf(!ENDPOINT)("DynamoJournalStore (integration)", () => {
  let raw: DynamoDBClient;
  let store: DynamoJournalStore;

  beforeAll(async () => {
    raw = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    try {
      await raw.send(
        new CreateTableCommand({
          TableName: TABLE,
          AttributeDefinitions: [
            { AttributeName: "tradeId", AttributeType: "S" },
            { AttributeName: "openedAt", AttributeType: "N" },
          ],
          KeySchema: [{ AttributeName: "tradeId", KeyType: "HASH" }],
          GlobalSecondaryIndexes: [
            {
              IndexName: "byOpenedAt",
              KeySchema: [
                { AttributeName: "tradeId", KeyType: "HASH" },
                { AttributeName: "openedAt", KeyType: "RANGE" },
              ],
              Projection: { ProjectionType: "ALL" },
              ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
            },
          ],
          BillingMode: "PROVISIONED",
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }),
      );
    } catch {
      // table already exists
    }
    store = new DynamoJournalStore({
      tableName: TABLE,
      endpoint: ENDPOINT!,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  });

  afterAll(async () => {
    raw.destroy();
    await store.close();
  });

  it("put + get round-trips", async () => {
    const j: TradeJournal = {
      tradeId: `t-${Date.now()}`,
      symbol: "EURUSD",
      openedAt: Date.now(),
      verdict: { direction: "long", confidence: 0.7, horizon: "H1", reasoning: "x" },
      risk: { approve: true, lotSize: 0.1, sl: 1.07, tp: 1.09, expiresAt: 0, reasons: ["ok"] },
    };
    await store.put(j);
    const got = await store.get(j.tradeId);
    expect(got?.symbol).toBe("EURUSD");
  });
});
```

- [ ] **Step 2: Run test (skipped without endpoint)**

Run: `pnpm vitest run packages/memory/test/dynamo-journal.integration.test.ts`
Expected: 0 tests run.

- [ ] **Step 3: Write `packages/memory/src/dynamo-journal.ts`**

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { TradeJournal } from "@forex-bot/contracts";
import type { JournalStore } from "@forex-bot/data-core";

export interface DynamoJournalStoreOptions {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class DynamoJournalStore implements JournalStore {
  private readonly tableName: string;
  private readonly raw: DynamoDBClient;
  private readonly doc: DynamoDBDocumentClient;

  constructor(opts: DynamoJournalStoreOptions) {
    this.tableName = opts.tableName;
    this.raw = new DynamoDBClient({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    });
    this.doc = DynamoDBDocumentClient.from(this.raw);
  }

  async close(): Promise<void> {
    this.raw.destroy();
  }

  async put(j: TradeJournal): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: { ...j } }));
  }

  async get(tradeId: string): Promise<TradeJournal | undefined> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { tradeId } }),
    );
    return r.Item ? (r.Item as TradeJournal) : undefined;
  }

  async list(opts: { limit: number; cursor?: string }): Promise<{
    items: readonly TradeJournal[];
    nextCursor?: string;
  }> {
    // For v1 we use Scan + sort in-memory, ordered by openedAt desc.
    // Production will swap to a GSI Query with the byOpenedAt index.
    const r = await this.doc.send(
      new ScanCommand({ TableName: this.tableName, Limit: 200 }),
    );
    const all = ((r.Items ?? []) as TradeJournal[])
      .slice()
      .sort((a, b) => b.openedAt - a.openedAt);
    const startIdx = opts.cursor ? Number(opts.cursor) : 0;
    const end = startIdx + opts.limit;
    const items = all.slice(startIdx, end);
    const nextCursor = end < all.length ? String(end) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  }
}
```

- [ ] **Step 4: Update `packages/memory/src/index.ts`**

```ts
export * from "./dynamo-journal.js";
export * from "./pgvector-rag.js";
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @forex-bot/memory typecheck`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): add DynamoJournalStore (integration test gated on DYNAMO_TEST_ENDPOINT)"
```

---

## Task 11: `memory` — composite write-with-embed helper + unit test

**Files:**
- Create: `packages/memory/src/journal-with-rag.ts`, `packages/memory/test/journal-with-rag.test.ts`
- Modify: `packages/memory/src/index.ts`

This task verifies the memory layer's typical write-flow against the in-memory fakes from `data-core`, so we get confidence without external services.

- [ ] **Step 1: Write the failing test `packages/memory/test/journal-with-rag.test.ts`**

```ts
import {
  FakeEmbeddingProvider,
  InMemoryJournalStore,
  InMemoryRagStore,
} from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { writeJournalWithRag } from "../src/journal-with-rag.js";

describe("writeJournalWithRag", () => {
  it("writes the journal and embeds rationale into the rag store", async () => {
    const journal = new InMemoryJournalStore();
    const rag = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 8, modelVersion: "fake-v1" });

    await writeJournalWithRag(
      {
        tradeId: "t-1",
        symbol: "EURUSD",
        openedAt: 1,
        verdict: { direction: "long", confidence: 0.8, horizon: "H1", reasoning: "trend continuation" },
        risk: {
          approve: true,
          lotSize: 0.1,
          sl: 1.07,
          tp: 1.09,
          expiresAt: 0,
          reasons: ["confluence"],
        },
      },
      { journal, rag, embed, regime: "trending" },
    );

    expect((await journal.get("t-1"))?.tradeId).toBe("t-1");
    const hits = await rag.search({ embedding: (await embed.embed(["trend continuation"]))[0]!, k: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.metadata.regime).toBe("trending");
    expect(hits[0]?.id).toBe("t-1");
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Write `packages/memory/src/journal-with-rag.ts`**

```ts
import type { TradeJournal } from "@forex-bot/contracts";
import type { EmbeddingProvider, JournalStore, RagStore } from "@forex-bot/data-core";

export interface WriteJournalWithRagDeps {
  journal: JournalStore;
  rag: RagStore;
  embed: EmbeddingProvider;
  regime?: string;
}

export async function writeJournalWithRag(
  j: TradeJournal,
  deps: WriteJournalWithRagDeps,
): Promise<void> {
  await deps.journal.put(j);
  const text = j.verdict.reasoning;
  const [embedding] = await deps.embed.embed([text]);
  if (!embedding) throw new Error("embed returned no vectors");
  const metadata: Record<string, string | number | boolean> = {
    tradeId: j.tradeId,
    symbol: j.symbol,
    direction: j.verdict.direction,
  };
  if (deps.regime) metadata.regime = deps.regime;
  await deps.rag.put({
    id: j.tradeId,
    text,
    embedding,
    modelVersion: deps.embed.modelVersion,
    metadata,
    ts: j.openedAt,
  });
}
```

- [ ] **Step 4: Update index**

```ts
export * from "./dynamo-journal.js";
export * from "./journal-with-rag.js";
export * from "./pgvector-rag.js";
```

- [ ] **Step 5: Run test**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): add writeJournalWithRag helper (journal + RAG embedding)"
```

---

## Task 12: `cache` — Redis-backed HotCache

**Files:**
- Create: `packages/cache/{package.json,tsconfig.json,src/{redis-cache.ts,index.ts},test/redis-cache.integration.test.ts}`

`REDIS_TEST_URL` gates the integration test (skipped without it, CI sets it via docker compose).

- [ ] **Step 1: Write `packages/cache/package.json`**

```json
{
  "name": "@forex-bot/cache",
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
    "ioredis": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template)

- [ ] **Step 3: Write the failing integration test `packages/cache/test/redis-cache.integration.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisHotCache } from "../src/redis-cache.js";

const URL = process.env.REDIS_TEST_URL;

describe.skipIf(!URL)("RedisHotCache (integration)", () => {
  let cache: RedisHotCache;

  beforeAll(async () => {
    cache = new RedisHotCache({ url: URL!, namespace: `test:${Date.now()}` });
    await cache.connect();
  });

  afterAll(async () => {
    await cache.close();
  });

  it("ticks round-trip per symbol", async () => {
    await cache.setLatestTick({ ts: 1, symbol: "EURUSD", bid: 1.08, ask: 1.0801 });
    expect((await cache.getLatestTick("EURUSD"))?.bid).toBe(1.08);
  });

  it("recentHeadlines respects sinceMs", async () => {
    await cache.pushHeadline({ ts: 100, source: "x", title: "old" });
    await cache.pushHeadline({ ts: 200, source: "x", title: "new" });
    const recent = await cache.recentHeadlines({ sinceMs: 150 });
    expect(recent.map((h) => h.title)).toEqual(["new"]);
  });
});
```

- [ ] **Step 4: Write `packages/cache/src/redis-cache.ts`**

```ts
import type {
  AccountState,
  CalendarEvent,
  NewsHeadline,
  Symbol,
  Tick,
} from "@forex-bot/contracts";
import type { HotCache } from "@forex-bot/data-core";
import Redis from "ioredis";

export interface RedisHotCacheOptions {
  url: string;
  /** Per-deployment namespace prefix. */
  namespace: string;
}

export class RedisHotCache implements HotCache {
  private readonly client: Redis;
  private readonly ns: string;

  constructor(opts: RedisHotCacheOptions) {
    this.client = new Redis(opts.url, { lazyConnect: true });
    this.ns = opts.namespace;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }

  async setLatestTick(t: Tick): Promise<void> {
    await this.client.set(`${this.ns}:tick:${t.symbol}`, JSON.stringify(t));
  }

  async getLatestTick(symbol: Symbol): Promise<Tick | undefined> {
    const v = await this.client.get(`${this.ns}:tick:${symbol}`);
    return v ? (JSON.parse(v) as Tick) : undefined;
  }

  async pushHeadline(h: NewsHeadline): Promise<void> {
    await this.client.zadd(`${this.ns}:headlines`, h.ts, JSON.stringify(h));
  }

  async recentHeadlines({ sinceMs, max }: { sinceMs: number; max?: number }): Promise<readonly NewsHeadline[]> {
    const raw = await this.client.zrangebyscore(
      `${this.ns}:headlines`,
      sinceMs,
      "+inf",
      ...(max !== undefined ? (["LIMIT", "0", String(max)] as const) : []),
    );
    return raw.map((s) => JSON.parse(s) as NewsHeadline);
  }

  async setCalendarWindow(events: readonly CalendarEvent[]): Promise<void> {
    await this.client.set(`${this.ns}:calendar`, JSON.stringify(events));
  }

  async getCalendarWindow(): Promise<readonly CalendarEvent[]> {
    const v = await this.client.get(`${this.ns}:calendar`);
    return v ? (JSON.parse(v) as CalendarEvent[]) : [];
  }

  async setAccountSnapshot(s: AccountState): Promise<void> {
    await this.client.set(`${this.ns}:account`, JSON.stringify(s));
  }

  async getAccountSnapshot(): Promise<AccountState | undefined> {
    const v = await this.client.get(`${this.ns}:account`);
    return v ? (JSON.parse(v) as AccountState) : undefined;
  }
}
```

- [ ] **Step 5: Write `packages/cache/src/index.ts`**

```ts
export * from "./redis-cache.js";
```

- [ ] **Step 6: Typecheck + (skipped) run**

Run: `pnpm install && pnpm --filter @forex-bot/cache typecheck && pnpm vitest run packages/cache`
Expected: typecheck OK; integration test suite skipped.

- [ ] **Step 7: Commit**

```bash
git add packages/cache pnpm-lock.yaml
git commit -m "feat(cache): add RedisHotCache (integration test gated on REDIS_TEST_URL)"
```

---

## Task 13: `data-ingest` app — scaffold + scheduler

**Files:**
- Create: `apps/data-ingest/{package.json,tsconfig.json,src/{scheduler.ts,index.ts},test/scheduler.test.ts}`
- Modify: `pnpm-workspace.yaml` (already includes `apps/*`)

- [ ] **Step 1: Write `apps/data-ingest/package.json`**

```json
{
  "name": "@forex-bot/data-ingest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.json --outDir dist",
    "start": "node --enable-source-maps dist/main.js"
  },
  "dependencies": {
    "@forex-bot/cache": "workspace:*",
    "@forex-bot/contracts": "workspace:*",
    "@forex-bot/data-core": "workspace:*",
    "@forex-bot/memory": "workspace:*"
  }
}
```

- [ ] **Step 2: Write tsconfig** (template)

- [ ] **Step 3: Write the failing test `apps/data-ingest/test/scheduler.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { runDueJobs, type Job } from "../src/scheduler.js";

describe("scheduler.runDueJobs", () => {
  it("runs jobs whose due time has elapsed", async () => {
    const ran: string[] = [];
    const jobs: Job[] = [
      { id: "news", intervalSec: 300, lastRunAt: 1000, run: async () => void ran.push("news") },
      { id: "cal", intervalSec: 900, lastRunAt: 1000, run: async () => void ran.push("cal") },
    ];
    await runDueJobs(jobs, { nowMs: 1000 + 600 * 1000 });
    expect(ran).toEqual(["news"]);
  });

  it("updates lastRunAt for jobs that ran", async () => {
    const job: Job = { id: "x", intervalSec: 60, lastRunAt: 0, run: async () => {} };
    await runDueJobs([job], { nowMs: 60_000 });
    expect(job.lastRunAt).toBe(60_000);
  });

  it("aggregates errors but does not stop other jobs", async () => {
    const ran: string[] = [];
    const jobs: Job[] = [
      { id: "a", intervalSec: 1, lastRunAt: 0, run: async () => { throw new Error("boom"); } },
      { id: "b", intervalSec: 1, lastRunAt: 0, run: async () => void ran.push("b") },
    ];
    const result = await runDueJobs(jobs, { nowMs: 60_000 });
    expect(ran).toEqual(["b"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.id).toBe("a");
  });
});
```

- [ ] **Step 4: Run test**

Expected: FAIL.

- [ ] **Step 5: Write `apps/data-ingest/src/scheduler.ts`**

```ts
export interface Job {
  id: string;
  intervalSec: number;
  /** unix ms; mutated when the job runs successfully or unsuccessfully */
  lastRunAt: number;
  run(now: number): Promise<void>;
}

export interface RunDueJobsResult {
  ran: readonly string[];
  errors: readonly { id: string; error: Error }[];
}

export async function runDueJobs(
  jobs: readonly Job[],
  opts: { nowMs: number },
): Promise<RunDueJobsResult> {
  const ran: string[] = [];
  const errors: { id: string; error: Error }[] = [];
  for (const j of jobs) {
    if (opts.nowMs - j.lastRunAt < j.intervalSec * 1000) continue;
    try {
      await j.run(opts.nowMs);
      ran.push(j.id);
    } catch (e) {
      errors.push({ id: j.id, error: e instanceof Error ? e : new Error(String(e)) });
    } finally {
      // Always advance lastRunAt — error retries should not hammer a flaky source on every tick.
      j.lastRunAt = opts.nowMs;
    }
  }
  return { ran, errors };
}
```

- [ ] **Step 6: Write `apps/data-ingest/src/index.ts`**

```ts
export * from "./scheduler.js";
```

- [ ] **Step 7: Run test**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps pnpm-lock.yaml
git commit -m "feat(data-ingest): scaffold app + scheduler primitive (runDueJobs)"
```

---

## Task 14: `data-ingest` — news worker

**Files:**
- Create: `apps/data-ingest/src/workers/news.ts`, `apps/data-ingest/test/news-worker.test.ts`

- [ ] **Step 1: Write the failing test `apps/data-ingest/test/news-worker.test.ts`**

```ts
import { InMemoryHotCache } from "@forex-bot/data-core";
import type { NewsAdapter } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { newsWorker } from "../src/workers/news.js";

const fake: NewsAdapter = {
  source: "fake",
  async fetch({ since }) {
    return [
      { ts: since + 1, source: "fake", title: "headline 1" },
      { ts: since + 2, source: "fake", title: "headline 2" },
    ];
  },
};

describe("newsWorker", () => {
  it("pushes headlines into the cache and tracks last-fetch ts", async () => {
    const cache = new InMemoryHotCache();
    const state = { lastFetchTs: 1000 };
    await newsWorker({ adapter: fake, cache, state, nowMs: 5000 });
    const recent = await cache.recentHeadlines({ sinceMs: 0 });
    expect(recent.map((h) => h.title)).toEqual(["headline 1", "headline 2"]);
    expect(state.lastFetchTs).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Write `apps/data-ingest/src/workers/news.ts`**

```ts
import type { HotCache, NewsAdapter } from "@forex-bot/data-core";

export interface NewsWorkerState {
  lastFetchTs: number;
}

export interface NewsWorkerInput {
  adapter: NewsAdapter;
  cache: HotCache;
  state: NewsWorkerState;
  nowMs: number;
}

export async function newsWorker(input: NewsWorkerInput): Promise<void> {
  const items = await input.adapter.fetch({
    since: input.state.lastFetchTs,
    until: input.nowMs,
  });
  for (const h of items) await input.cache.pushHeadline(h);
  input.state.lastFetchTs = input.nowMs;
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/data-ingest
git commit -m "feat(data-ingest): add news worker pushing headlines to cache"
```

---

## Task 15: `data-ingest` — calendar worker

**Files:**
- Create: `apps/data-ingest/src/workers/calendar.ts`, `apps/data-ingest/test/calendar-worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { InMemoryHotCache } from "@forex-bot/data-core";
import type { CalendarAdapter } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { calendarWorker } from "../src/workers/calendar.js";

const fake: CalendarAdapter = {
  source: "fake",
  async fetch({ since }) {
    return [
      { ts: since + 1, currency: "USD", impact: "high", title: "CPI" },
      { ts: since + 2, currency: "EUR", impact: "medium", title: "PMI" },
    ];
  },
};

describe("calendarWorker", () => {
  it("replaces the calendar window with the next-48h slice", async () => {
    const cache = new InMemoryHotCache();
    await calendarWorker({ adapter: fake, cache, nowMs: 1000, lookaheadMs: 48 * 60 * 60 * 1000 });
    const window = await cache.getCalendarWindow();
    expect(window.map((e) => e.currency)).toEqual(["USD", "EUR"]);
  });
});
```

- [ ] **Step 2: Run test (FAIL).**

- [ ] **Step 3: Write `apps/data-ingest/src/workers/calendar.ts`**

```ts
import type { CalendarAdapter, HotCache } from "@forex-bot/data-core";

export interface CalendarWorkerInput {
  adapter: CalendarAdapter;
  cache: HotCache;
  nowMs: number;
  lookaheadMs: number;
}

export async function calendarWorker(input: CalendarWorkerInput): Promise<void> {
  const events = await input.adapter.fetch({
    since: input.nowMs,
    until: input.nowMs + input.lookaheadMs,
  });
  await input.cache.setCalendarWindow(events);
}
```

- [ ] **Step 4: Run test (PASS).**

- [ ] **Step 5: Commit**

```bash
git add apps/data-ingest
git commit -m "feat(data-ingest): add calendar worker replacing rolling 48h window"
```

---

## Task 16: `data-ingest` — CB press worker

**Files:**
- Create: `apps/data-ingest/src/workers/cb-press.ts`, `apps/data-ingest/test/cb-press-worker.test.ts`

This worker writes CB documents into the RAG store via `EmbeddingProvider`. Unit-tested with `FakeEmbeddingProvider` + `InMemoryRagStore`.

- [ ] **Step 1: Write the failing test**

```ts
import {
  FakeEmbeddingProvider,
  InMemoryRagStore,
} from "@forex-bot/data-core";
import type { CbAdapter } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { cbPressWorker } from "../src/workers/cb-press.js";

const fake: CbAdapter = {
  source: "fake",
  async fetch({ since }) {
    return [
      {
        ts: since + 1,
        bank: "FED",
        kind: "press_release",
        title: "FOMC statement",
        url: "https://example/1",
        body: "Rates unchanged. Inflation pressures easing.",
      },
    ];
  },
};

describe("cbPressWorker", () => {
  it("embeds CB documents and writes them into the RAG store", async () => {
    const rag = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 4, modelVersion: "fake-v1" });
    const state = { lastFetchTs: 0 };
    await cbPressWorker({ adapter: fake, rag, embed, state, nowMs: 100 });
    const out = await rag.search({ embedding: (await embed.embed(["Rates unchanged. Inflation pressures easing."]))[0]!, k: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]?.metadata.bank).toBe("FED");
    expect(state.lastFetchTs).toBe(100);
  });
});
```

- [ ] **Step 2: Run (FAIL).**

- [ ] **Step 3: Write `apps/data-ingest/src/workers/cb-press.ts`**

```ts
import type { CbAdapter, EmbeddingProvider, RagStore } from "@forex-bot/data-core";

export interface CbPressWorkerState {
  lastFetchTs: number;
}

export interface CbPressWorkerInput {
  adapter: CbAdapter;
  rag: RagStore;
  embed: EmbeddingProvider;
  state: CbPressWorkerState;
  nowMs: number;
}

export async function cbPressWorker(input: CbPressWorkerInput): Promise<void> {
  const docs = await input.adapter.fetch({
    since: input.state.lastFetchTs,
    until: input.nowMs,
  });
  if (docs.length === 0) {
    input.state.lastFetchTs = input.nowMs;
    return;
  }
  const embeddings = await input.embed.embed(docs.map((d) => d.body));
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i] as (typeof docs)[number];
    const e = embeddings[i] as readonly number[];
    await input.rag.put({
      id: `${d.bank}:${d.kind}:${d.ts}`,
      text: d.body,
      embedding: e,
      modelVersion: input.embed.modelVersion,
      metadata: { bank: d.bank, kind: d.kind, source: input.adapter.source, url: d.url, title: d.title },
      ts: d.ts,
    });
  }
  input.state.lastFetchTs = input.nowMs;
}
```

- [ ] **Step 4: Run (PASS).**

- [ ] **Step 5: Commit**

```bash
git add apps/data-ingest
git commit -m "feat(data-ingest): add CB press worker (fetch + embed + RAG write)"
```

---

## Task 17: `data-ingest` — COT worker

**Files:**
- Create: `apps/data-ingest/src/workers/cot.ts`, `apps/data-ingest/test/cot-worker.test.ts`

The COT worker writes weekly reports to the journal store as a JSON blob keyed by report timestamp. Sentiment use is downstream (Plan 4).

- [ ] **Step 1: Write the failing test**

```ts
import type { CotAdapter, RagStore } from "@forex-bot/data-core";
import { FakeEmbeddingProvider, InMemoryRagStore } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { cotWorker } from "../src/workers/cot.js";

const fake: CotAdapter = {
  source: "cftc-fake",
  async fetch() {
    return [
      { ts: 100, symbol: "EURUSD", netNonCommercial: 50_000, netCommercial: -60_000, changeWeekly: 1_000 },
      { ts: 100, symbol: "GBPUSD", netNonCommercial: 30_000, netCommercial: -40_000, changeWeekly: -500 },
    ];
  },
};

describe("cotWorker", () => {
  it("writes one RagDoc per report row with COT metadata", async () => {
    const rag: RagStore = new InMemoryRagStore();
    const embed = new FakeEmbeddingProvider({ dimension: 4, modelVersion: "fake-v1" });
    const state = { lastFetchTs: 0 };
    await cotWorker({ adapter: fake, rag, embed, state, nowMs: 200 });
    const all = await rag.search({ embedding: [1, 0, 0, 0], k: 5 });
    expect(all).toHaveLength(2);
    expect(all.every((d) => d.metadata.source === "cftc-fake")).toBe(true);
    expect(state.lastFetchTs).toBe(200);
  });
});
```

- [ ] **Step 2: Run (FAIL).**

- [ ] **Step 3: Write `apps/data-ingest/src/workers/cot.ts`**

```ts
import type { CotAdapter, EmbeddingProvider, RagStore } from "@forex-bot/data-core";

export interface CotWorkerState {
  lastFetchTs: number;
}

export interface CotWorkerInput {
  adapter: CotAdapter;
  rag: RagStore;
  embed: EmbeddingProvider;
  state: CotWorkerState;
  nowMs: number;
}

export async function cotWorker(input: CotWorkerInput): Promise<void> {
  const reports = await input.adapter.fetch({
    since: input.state.lastFetchTs,
    until: input.nowMs,
  });
  const texts = reports.map(
    (r) => `${r.symbol} COT: net non-commercial ${r.netNonCommercial}, change ${r.changeWeekly}`,
  );
  if (texts.length === 0) {
    input.state.lastFetchTs = input.nowMs;
    return;
  }
  const embeddings = await input.embed.embed(texts);
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i] as (typeof reports)[number];
    const e = embeddings[i] as readonly number[];
    const text = texts[i] as string;
    await input.rag.put({
      id: `cot:${r.symbol}:${r.ts}`,
      text,
      embedding: e,
      modelVersion: input.embed.modelVersion,
      metadata: {
        source: input.adapter.source,
        symbol: r.symbol,
        netNonCommercial: r.netNonCommercial,
        netCommercial: r.netCommercial,
        changeWeekly: r.changeWeekly,
      },
      ts: r.ts,
    });
  }
  input.state.lastFetchTs = input.nowMs;
}
```

- [ ] **Step 4: Run (PASS).**

- [ ] **Step 5: Commit**

```bash
git add apps/data-ingest
git commit -m "feat(data-ingest): add COT worker writing weekly reports as RAG docs"
```

---

## Task 18: docker-compose for local dev + integration tests

**Files:**
- Create: `docker-compose.yml`, `scripts/dev-up.sh`, `scripts/dev-down.sh`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: forex
      POSTGRES_PASSWORD: forex
      POSTGRES_DB: forex
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forex -d forex"]
      interval: 2s
      timeout: 3s
      retries: 30

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 30

  dynamodb:
    image: amazon/dynamodb-local:2.5.2
    command: ["-jar", "DynamoDBLocal.jar", "-sharedDb", "-inMemory"]
    ports:
      - "8000:8000"
```

- [ ] **Step 2: Write `scripts/dev-up.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d
echo "Waiting for services..."
docker compose ps
cat <<EOF
export PG_TEST_URL="postgres://forex:forex@127.0.0.1:5432/forex"
export REDIS_TEST_URL="redis://127.0.0.1:6379"
export DYNAMO_TEST_ENDPOINT="http://127.0.0.1:8000"
EOF
```

- [ ] **Step 3: Write `scripts/dev-down.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down -v
```

- [ ] **Step 4: chmod + smoke**

Run:
```bash
chmod +x scripts/dev-up.sh scripts/dev-down.sh
./scripts/dev-up.sh
eval "$(./scripts/dev-up.sh | grep '^export ')"
pnpm vitest run packages/cache packages/memory
./scripts/dev-down.sh
```
Expected: integration suites run; tests pass against the live services.

> If Docker is unavailable in the dev environment, mark this verification as deferred — the CI job (Task 19) is the canonical run.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml scripts/dev-up.sh scripts/dev-down.sh
git commit -m "ci: add docker-compose for postgres+pgvector / redis / dynamodb-local"
```

---

## Task 19: CI — extend ts job with integration services

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the `ts` job in `.github/workflows/ci.yml`**

```yaml
  ts:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: forex
          POSTGRES_PASSWORD: forex
          POSTGRES_DB: forex
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U forex -d forex"
          --health-interval=2s --health-timeout=3s --health-retries=30
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=2s --health-timeout=3s --health-retries=30
      dynamodb:
        image: amazon/dynamodb-local:2.5.2
        ports: ["8000:8000"]
    env:
      PG_TEST_URL: postgres://forex:forex@127.0.0.1:5432/forex
      REDIS_TEST_URL: redis://127.0.0.1:6379
      DYNAMO_TEST_ENDPOINT: http://127.0.0.1:8000
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: sudo apt-get update && sudo apt-get install -y protobuf-compiler
      - run: pnpm install --frozen-lockfile
      - run: pnpm proto:gen
      - run: pnpm -r typecheck
      - run: pnpm lint
      - run: pnpm test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
```

> The `python` job is unchanged.

- [ ] **Step 2: Verify locally with compose**

Run:
```bash
./scripts/dev-up.sh
eval "$(./scripts/dev-up.sh | grep '^export ')"
pnpm install --frozen-lockfile && pnpm proto:gen && pnpm -r typecheck && pnpm lint && pnpm test
./scripts/dev-down.sh
```
Expected: all green, including integration suites for `cache` and `memory`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: spin up postgres/redis/dynamodb services for ts integration tests"
```

---

## Task 20: README updates

**Files:**
- Create: `README.md` (or modify if it exists)

- [ ] **Step 1: Write `README.md`**

```markdown
# forex-bot

AI-driven forex trading system. See `prd/` for design specs and per-plan implementation guides.

## Repository structure

- `proto/` — gRPC contract files (single source of truth).
- `mt5-sidecar/` — Python service that talks to MetaTrader 5 over gRPC.
- `packages/` — TypeScript libraries (contracts, indicators, risk, broker-core, broker-mt5, executor, data-core, news-rss, news-api, calendar-forexfactory, cb-scrapers, cot, memory, cache).
- `apps/` — runnable workers (data-ingest).
- `eval/` — backtest/replay harnesses (future plan).
- `infra/` — IaC (future plan).

## Local development

```bash
nvm use            # Node 20+
corepack enable
pnpm install
pnpm proto:gen     # generate ts-proto stubs (needs `protoc`)
pnpm -r typecheck
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
| 1 — Foundations | ✅ | contracts, indicators, risk |
| 2 — MT5 Bridge & Executor | ✅ | proto, broker-core, broker-mt5, executor, mt5-sidecar |
| 3 — Data Layer | ▶️ | adapters, memory, cache, data-ingest |
| 4 — Agent Graph | ⏳ | LangGraph, agents, agent-runner |
| 5 — Eval Harness | ⏳ | replay, event-study, paper |
| 6 — Infra & Ops | ⏳ | IaC, ops-cli, observability |
| 7 — Go-Live Controls | ⏳ | canary, chaos drills, gates |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add top-level README with repo layout and dev workflow"
```

---

## Done-Done Checklist

Before declaring Plan 3 complete:

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm proto:gen` regenerates broker-mt5 stubs deterministically.
- [ ] `pnpm -r typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes (unit-only, no docker required).
- [ ] With `./scripts/dev-up.sh` services running and env vars exported, `pnpm test` adds integration tests for `memory` and `cache` and they pass.
- [ ] `apps/data-ingest` typechecks; the four worker functions are exercised by their tests.
- [ ] CI workflow `ts` job spins up postgres/redis/dynamodb services and runs green.
- [ ] No package imports a sibling package except via `@forex-bot/<name>`.
- [ ] No production code uses `any`, `as unknown as`, or hits the network outside an injectable fetcher.

## Deferred to future plans

- ECB, BoE, BoJ, SNB, RBA, RBNZ press + speech scrapers (Plan 4 will need the speech ones first; mechanical clones of `FedPressAdapter`).
- Real CFTC fixed-width text parsing (Task 7 ships the structured-input adapter; the wire-format parser is deferred).
- `JournalStore.list` Query against `byOpenedAt` GSI (Task 10 ships Scan-then-sort for v1).
- pgvector index tuning (`lists` parameter; once we have realistic doc volume).
- Embedding model choice (Voyage / OpenAI / local) per design spec §11.
- Sentiment analyst integration of these data streams — that is Plan 4.
