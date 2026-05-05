import type { AccountState, CalendarEvent, NewsHeadline, Symbol, Tick } from "@forex-bot/contracts";
import type { HotCache } from "@forex-bot/data-core";
import type { ReplayClock } from "@forex-bot/eval-core";

const CALENDAR_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export interface FixtureHotCacheOpts {
  clock: ReplayClock;
  /** All headlines for the replay window. */
  headlines: readonly NewsHeadline[];
  /** All calendar events for the replay window. */
  calendar: readonly CalendarEvent[];
}

/**
 * Replay-aware in-memory `HotCache`. Headlines and calendar reads are gated
 * by the {@link ReplayClock} so the runner only sees information that would
 * have been available at the simulated current time.
 *
 * Mirrors `InMemoryHotCache` for ticks and account snapshots — these are
 * imperatively set by the replay engine and don't need clock gating.
 */
export class FixtureHotCache implements HotCache {
  private readonly clock: ReplayClock;
  private readonly headlines: NewsHeadline[];
  private calendar: CalendarEvent[];
  private readonly ticks = new Map<Symbol, Tick>();
  private account?: AccountState;

  constructor(opts: FixtureHotCacheOpts) {
    this.clock = opts.clock;
    this.headlines = [...opts.headlines];
    this.calendar = [...opts.calendar];
  }

  async setLatestTick(t: Tick): Promise<void> {
    this.ticks.set(t.symbol, t);
  }

  async getLatestTick(symbol: Symbol): Promise<Tick | undefined> {
    return this.ticks.get(symbol);
  }

  async pushHeadline(h: NewsHeadline): Promise<void> {
    this.headlines.push(h);
  }

  async recentHeadlines({
    sinceMs,
    max,
  }: { sinceMs: number; max?: number }): Promise<readonly NewsHeadline[]> {
    const now = this.clock.now();
    const filtered = this.headlines.filter((h) => h.ts >= sinceMs && h.ts <= now);
    return max ? filtered.slice(-max) : filtered;
  }

  async setCalendarWindow(events: readonly CalendarEvent[]): Promise<void> {
    this.calendar = [...events];
  }

  async getCalendarWindow(): Promise<readonly CalendarEvent[]> {
    const upper = this.clock.now() + CALENDAR_LOOKAHEAD_MS;
    return this.calendar.filter((e) => e.ts <= upper);
  }

  async setAccountSnapshot(s: AccountState): Promise<void> {
    this.account = { ...s };
  }

  async getAccountSnapshot(): Promise<AccountState | undefined> {
    return this.account;
  }
}
