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
