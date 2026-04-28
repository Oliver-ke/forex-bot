import type { CalendarEvent } from "@forex-bot/contracts";
import type { CalendarAdapter, FetchWindow } from "@forex-bot/data-core";

interface FfRow {
  title: string;
  country: string;
  date: string;
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
    this.fetcher =
      opts.fetcher ??
      (async (u) => {
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
      if (!impact) continue;
      if (!/^[A-Z]{3}$/.test(r.country)) continue;
      const forecast = r.forecast ? parseNumeric(r.forecast) : undefined;
      const previous = r.previous ? parseNumeric(r.previous) : undefined;
      const actual = r.actual ? parseNumeric(r.actual) : undefined;
      out.push({
        ts,
        currency: r.country,
        impact,
        title: r.title,
        ...(forecast !== undefined ? { forecast } : {}),
        ...(previous !== undefined ? { previous } : {}),
        ...(actual !== undefined ? { actual } : {}),
      });
    }
    return out;
  }
}

function mapImpact(raw: string): "low" | "medium" | "high" | undefined {
  switch (raw) {
    case "High":
      return "high";
    case "Medium":
      return "medium";
    case "Low":
      return "low";
    default:
      return undefined;
  }
}

function parseNumeric(raw: string): number | undefined {
  const cleaned = raw.replace(/[%KkMm$]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}
