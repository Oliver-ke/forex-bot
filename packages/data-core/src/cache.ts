import type { AccountState, CalendarEvent, NewsHeadline, Symbol, Tick } from "@forex-bot/contracts";

export interface HotCache {
  setLatestTick(t: Tick): Promise<void>;
  getLatestTick(symbol: Symbol): Promise<Tick | undefined>;

  pushHeadline(h: NewsHeadline): Promise<void>;
  recentHeadlines(opts: { sinceMs: number; max?: number }): Promise<readonly NewsHeadline[]>;

  setCalendarWindow(events: readonly CalendarEvent[]): Promise<void>;
  getCalendarWindow(): Promise<readonly CalendarEvent[]>;

  setAccountSnapshot(s: AccountState): Promise<void>;
  getAccountSnapshot(): Promise<AccountState | undefined>;
}
