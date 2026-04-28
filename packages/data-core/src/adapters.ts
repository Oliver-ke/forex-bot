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
  ts: number;
  bank: "FED" | "ECB" | "BOE" | "BOJ" | "SNB" | "RBA" | "RBNZ";
  kind: "press_release" | "speech" | "minutes";
  title: string;
  url: string;
  body: string;
}

export interface CbAdapter {
  readonly source: string;
  fetch(window: FetchWindow): Promise<readonly CbDocument[]>;
}

export interface CotReport {
  ts: number;
  symbol: Symbol;
  netNonCommercial: number;
  netCommercial: number;
  changeWeekly: number;
}

export interface CotAdapter {
  readonly source: string;
  fetch(window: FetchWindow): Promise<readonly CotReport[]>;
}
