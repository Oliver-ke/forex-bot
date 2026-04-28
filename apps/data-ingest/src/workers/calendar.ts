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
