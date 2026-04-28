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

  async recentHeadlines({
    sinceMs,
    max,
  }: { sinceMs: number; max?: number }): Promise<readonly NewsHeadline[]> {
    const raw =
      max !== undefined
        ? await this.client.zrangebyscore(
            `${this.ns}:headlines`,
            sinceMs,
            "+inf",
            "LIMIT",
            0,
            max,
          )
        : await this.client.zrangebyscore(`${this.ns}:headlines`, sinceMs, "+inf");
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
