import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBars } from "../src/fixture-bars.js";
import { loadCalendar } from "../src/fixture-calendar.js";
import { loadHeadlines } from "../src/fixture-headlines.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("loadBars", () => {
  it("loads a valid CSV of EURUSD bars", async () => {
    const path = join(FIXTURES, "bars-eurusd.csv");
    const bars = await loadBars(path, "EURUSD");
    expect(bars).toHaveLength(5);
    const first = bars[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("unreachable");
    expect(first.ts).toBe(1000);
    expect(first.open).toBeCloseTo(1.1);
    expect(first.close).toBeCloseTo(1.101);
    const last = bars[4];
    expect(last).toBeDefined();
    if (!last) throw new Error("unreachable");
    expect(last.ts).toBe(5000);
    expect(last.volume).toBe(1900);
  });

  it("throws for non-monotonic ts, including the file path in the message", async () => {
    const path = join(FIXTURES, "bars-bad-nonmono.csv");
    await expect(loadBars(path, "EURUSD")).rejects.toThrow(path);
  });
});

describe("loadHeadlines", () => {
  it("loads a valid JSON array of NewsHeadlines", async () => {
    const path = join(FIXTURES, "headlines.json");
    const headlines = await loadHeadlines(path);
    expect(headlines).toHaveLength(2);
    const first = headlines[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("unreachable");
    expect(first.source).toBe("Reuters");
    expect(first.title).toBe("ECB holds rates steady");
    expect(first.symbolsMentioned).toEqual(["EURUSD"]);
  });

  it("throws for invalid headline (missing title), including the file path", async () => {
    const path = join(FIXTURES, "headlines-bad.json");
    await expect(loadHeadlines(path)).rejects.toThrow(path);
  });
});

describe("loadCalendar", () => {
  it("loads a valid JSON array of CalendarEvents", async () => {
    const path = join(FIXTURES, "calendar.json");
    const events = await loadCalendar(path);
    expect(events).toHaveLength(2);
    const first = events[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("unreachable");
    expect(first.currency).toBe("USD");
    expect(first.impact).toBe("high");
    expect(first.title).toBe("Non-Farm Payrolls");
  });

  it("throws for invalid impact value, including the file path", async () => {
    const path = join(FIXTURES, "calendar-bad.json");
    await expect(loadCalendar(path)).rejects.toThrow(path);
  });
});
