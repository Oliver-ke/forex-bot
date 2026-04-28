import type { CalendarAdapter } from "@forex-bot/data-core";
import { InMemoryHotCache } from "@forex-bot/data-core";
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
    await calendarWorker({
      adapter: fake,
      cache,
      nowMs: 1000,
      lookaheadMs: 48 * 60 * 60 * 1000,
    });
    const window = await cache.getCalendarWindow();
    expect(window.map((e) => e.currency)).toEqual(["USD", "EUR"]);
  });
});
