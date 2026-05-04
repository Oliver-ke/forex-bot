import type { AccountState, CalendarEvent, NewsHeadline, Tick } from "@forex-bot/contracts";
import { ReplayClock } from "@forex-bot/eval-core";
import { describe, expect, it } from "vitest";
import { FixtureHotCache } from "../src/fixture-cache.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function headline(ts: number, title: string): NewsHeadline {
  return { ts, source: "test", title };
}

function calendar(ts: number, title: string): CalendarEvent {
  return { ts, currency: "USD", impact: "medium", title };
}

describe("FixtureHotCache", () => {
  describe("recentHeadlines", () => {
    it("filters to ts >= sinceMs && ts <= clock.now()", async () => {
      const clock = new ReplayClock(10_000);
      const headlines = [
        headline(5_000, "h1"),
        headline(8_000, "h2"),
        headline(12_000, "h3"),
        headline(15_000, "h4"),
      ];
      const cache = new FixtureHotCache({ clock, headlines, calendar: [] });
      const got = await cache.recentHeadlines({ sinceMs: 6_000 });
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("h2");
    });

    it("expands the window as the clock advances", async () => {
      const clock = new ReplayClock(10_000);
      const headlines = [
        headline(5_000, "h1"),
        headline(8_000, "h2"),
        headline(12_000, "h3"),
        headline(15_000, "h4"),
      ];
      const cache = new FixtureHotCache({ clock, headlines, calendar: [] });

      clock.advanceTo(14_000);
      const got = await cache.recentHeadlines({ sinceMs: 6_000 });
      expect(got).toHaveLength(2);
      expect(got.map((h) => h.title)).toEqual(["h2", "h3"]);
    });

    it("respects max by returning the most recent qualifying headlines", async () => {
      const clock = new ReplayClock(20_000);
      const headlines = [
        headline(5_000, "h1"),
        headline(8_000, "h2"),
        headline(12_000, "h3"),
        headline(15_000, "h4"),
      ];
      const cache = new FixtureHotCache({ clock, headlines, calendar: [] });
      const got = await cache.recentHeadlines({ sinceMs: 0, max: 1 });
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("h4");
    });

    it("pushHeadline adds a headline that subsequent reads see", async () => {
      const clock = new ReplayClock(10_000);
      const cache = new FixtureHotCache({ clock, headlines: [], calendar: [] });
      await cache.pushHeadline(headline(9_000, "added"));
      const got = await cache.recentHeadlines({ sinceMs: 0 });
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("added");
    });

    it("pushed future headlines remain hidden until clock catches up", async () => {
      const clock = new ReplayClock(1_000);
      const cache = new FixtureHotCache({ clock, headlines: [], calendar: [] });
      await cache.pushHeadline(headline(5_000, "future"));
      expect(await cache.recentHeadlines({ sinceMs: 0 })).toHaveLength(0);

      clock.advanceTo(5_000);
      const got = await cache.recentHeadlines({ sinceMs: 0 });
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("future");
    });
  });

  describe("calendar", () => {
    it("getCalendarWindow returns events with ts <= now + 7d", async () => {
      const clock = new ReplayClock(10_000);
      const inWindow = calendar(10_000 + SEVEN_DAYS_MS - 1, "in-window");
      const farFuture = calendar(10_000 + SEVEN_DAYS_MS + 1, "far-future");
      const cache = new FixtureHotCache({
        clock,
        headlines: [],
        calendar: [inWindow, farFuture],
      });
      const got = await cache.getCalendarWindow();
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("in-window");
    });

    it("does not filter on lower bound (past events stay visible)", async () => {
      const clock = new ReplayClock(10_000);
      const past = calendar(0, "past");
      const cache = new FixtureHotCache({ clock, headlines: [], calendar: [past] });
      const got = await cache.getCalendarWindow();
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("past");
    });

    it("setCalendarWindow replaces internal calendar", async () => {
      const clock = new ReplayClock(0);
      const cache = new FixtureHotCache({
        clock,
        headlines: [],
        calendar: [calendar(0, "old")],
      });
      await cache.setCalendarWindow([calendar(0, "new")]);
      const got = await cache.getCalendarWindow();
      expect(got).toHaveLength(1);
      expect(got[0]?.title).toBe("new");
    });
  });

  describe("ticks", () => {
    it("setLatestTick / getLatestTick round-trip per symbol", async () => {
      const clock = new ReplayClock(0);
      const cache = new FixtureHotCache({ clock, headlines: [], calendar: [] });
      const t1: Tick = { ts: 1_000, symbol: "EURUSD", bid: 1.1, ask: 1.1001 };
      const t2: Tick = { ts: 1_000, symbol: "USDJPY", bid: 150.0, ask: 150.01 };
      await cache.setLatestTick(t1);
      await cache.setLatestTick(t2);
      expect(await cache.getLatestTick("EURUSD")).toEqual(t1);
      expect(await cache.getLatestTick("USDJPY")).toEqual(t2);
      expect(await cache.getLatestTick("GBPUSD")).toBeUndefined();
    });

    it("setLatestTick overwrites prior tick for the same symbol", async () => {
      const clock = new ReplayClock(0);
      const cache = new FixtureHotCache({ clock, headlines: [], calendar: [] });
      const t1: Tick = { ts: 1_000, symbol: "EURUSD", bid: 1.1, ask: 1.1001 };
      const t2: Tick = { ts: 2_000, symbol: "EURUSD", bid: 1.2, ask: 1.2001 };
      await cache.setLatestTick(t1);
      await cache.setLatestTick(t2);
      expect(await cache.getLatestTick("EURUSD")).toEqual(t2);
    });
  });

  describe("account snapshot", () => {
    it("setAccountSnapshot / getAccountSnapshot round-trip", async () => {
      const clock = new ReplayClock(0);
      const cache = new FixtureHotCache({ clock, headlines: [], calendar: [] });
      expect(await cache.getAccountSnapshot()).toBeUndefined();
      const snapshot: AccountState = {
        ts: 1_000,
        currency: "USD",
        balance: 10_000,
        equity: 10_000,
        freeMargin: 10_000,
        usedMargin: 0,
        marginLevelPct: 0,
      };
      await cache.setAccountSnapshot(snapshot);
      expect(await cache.getAccountSnapshot()).toEqual(snapshot);
    });
  });
});
