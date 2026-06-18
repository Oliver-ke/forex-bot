import type { Candle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET_STALE_MS, feedAgeMs, isMarketClosed } from "../src/market.js";

const HOUR = 60 * 60 * 1000;
function candleAt(ts: number): Candle {
  return { ts, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

describe("market staleness helpers", () => {
  const now = 1_000_000_000_000;

  it("feedAgeMs is the age of the latest candle; Infinity when empty", () => {
    expect(feedAgeMs([candleAt(now - HOUR)], now)).toBe(HOUR);
    expect(feedAgeMs([candleAt(now - HOUR), candleAt(now - 1000)], now)).toBe(1000);
    expect(feedAgeMs([], now)).toBe(Number.POSITIVE_INFINITY);
  });

  it("fresh feed (1h old) is open under the 3h default", () => {
    expect(isMarketClosed([candleAt(now - HOUR)], now)).toBe(false);
  });

  it("stale feed (older than threshold) is closed", () => {
    expect(isMarketClosed([candleAt(now - 4 * HOUR)], now)).toBe(true);
    expect(isMarketClosed([candleAt(now - 3 * 24 * HOUR)], now)).toBe(true); // weekend
    expect(isMarketClosed([], now)).toBe(true); // no data
  });

  it("respects a custom threshold", () => {
    expect(isMarketClosed([candleAt(now - 2 * HOUR)], now, HOUR)).toBe(true);
    expect(isMarketClosed([candleAt(now - 30 * 60 * 1000)], now, HOUR)).toBe(false);
  });

  it("default threshold is 3h", () => {
    expect(DEFAULT_MARKET_STALE_MS).toBe(3 * HOUR);
  });
});
