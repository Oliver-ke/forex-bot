import type { Candle, Symbol, Timeframe } from "@forex-bot/contracts";
import { ReplayClock } from "@forex-bot/eval-core";
import { describe, expect, it } from "vitest";
import { FixtureBroker } from "../src/fixture-broker.js";

function bar(ts: number, close: number, openOffset = 0): Candle {
  const open = close - openOffset;
  const high = Math.max(open, close) + 0.0005;
  const low = Math.min(open, close) - 0.0005;
  return { ts, open, high, low, close, volume: 1 };
}

function key(symbol: Symbol, tf: Timeframe): string {
  return `${symbol}:${tf}`;
}

describe("FixtureBroker", () => {
  describe("getCandles", () => {
    it("returns only bars with ts <= clock.now()", async () => {
      const clock = new ReplayClock(1500);
      const bars = new Map<string, readonly Candle[]>([
        [
          key("EURUSD", "M15"),
          [bar(0, 1.1), bar(1000, 1.1001), bar(2000, 1.1002), bar(3000, 1.1003)],
        ],
      ]);
      const broker = new FixtureBroker({ clock, bars });
      const got = await broker.getCandles("EURUSD", "M15", 10);
      expect(got).toHaveLength(2);
      expect(got[0]?.ts).toBe(0);
      expect(got[1]?.ts).toBe(1000);
    });

    it("respects limit (last N)", async () => {
      const clock = new ReplayClock(5000);
      const bars = new Map<string, readonly Candle[]>([
        [
          key("EURUSD", "M15"),
          [bar(0, 1.1), bar(1000, 1.1001), bar(2000, 1.1002), bar(3000, 1.1003)],
        ],
      ]);
      const broker = new FixtureBroker({ clock, bars });
      const got = await broker.getCandles("EURUSD", "M15", 2);
      expect(got).toHaveLength(2);
      expect(got[0]?.ts).toBe(2000);
      expect(got[1]?.ts).toBe(3000);
    });

    it("changes as the clock advances", async () => {
      const clock = new ReplayClock(1500);
      const bars = new Map<string, readonly Candle[]>([
        [
          key("EURUSD", "M15"),
          [bar(0, 1.1), bar(1000, 1.1001), bar(2000, 1.1002), bar(3000, 1.1003)],
        ],
      ]);
      const broker = new FixtureBroker({ clock, bars });
      let got = await broker.getCandles("EURUSD", "M15", 10);
      expect(got).toHaveLength(2);

      clock.advanceTo(2500);
      got = await broker.getCandles("EURUSD", "M15", 10);
      expect(got).toHaveLength(3);
      expect(got[2]?.ts).toBe(2000);
    });

    it("returns [] when no bars exist for the key", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>();
      const broker = new FixtureBroker({ clock, bars });
      const got = await broker.getCandles("EURUSD", "M15", 10);
      expect(got).toEqual([]);
    });
  });

  describe("getQuote", () => {
    it("uses last bar's close + spread", async () => {
      const clock = new ReplayClock(2500);
      const bars = new Map<string, readonly Candle[]>([
        [key("EURUSD", "M15"), [bar(0, 1.09999), bar(1000, 1.10001), bar(2000, 1.1)]],
      ]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 1 });
      const quote = await broker.getQuote("EURUSD");
      expect(quote.bid).toBeCloseTo(1.1, 5);
      expect(quote.ask).toBeCloseTo(1.1001, 5);
      expect(quote.ts).toBe(2500);
      expect(quote.symbol).toBe("EURUSD");
    });

    it("uses default pipScale of 0.01 for JPY pairs", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("USDJPY", "M15"), [bar(0, 150.0)]]]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 1 });
      const quote = await broker.getQuote("USDJPY");
      expect(quote.ask).toBeCloseTo(150.01, 5);
    });

    it("falls back to shorter timeframes when M15 unavailable", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([
        [key("EURUSD", "M5"), [bar(0, 1.2), bar(500, 1.2001)]],
      ]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 0 });
      const quote = await broker.getQuote("EURUSD");
      expect(quote.bid).toBeCloseTo(1.2001, 5);
      expect(quote.ask).toBeCloseTo(1.2001, 5);
    });

    it("throws when no bars exist for the symbol", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>();
      const broker = new FixtureBroker({ clock, bars });
      await expect(broker.getQuote("EURUSD")).rejects.toThrow(/no bars/i);
    });
  });

  describe("placeOrder + closePosition", () => {
    it("buy: pnl = (closeBid - entryAsk)/pipScale * lotSize * pipValuePerLot", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([
        [key("EURUSD", "M15"), [bar(0, 1.1), bar(1000, 1.1)]],
      ]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 2 });
      const placed = await broker.placeOrder({
        symbol: "EURUSD",
        side: "buy",
        lotSize: 0.1,
        type: "market",
        sl: 1.095,
        tp: 1.105,
      });
      // entryAsk = 1.1 + 2*0.0001 = 1.1002
      expect(placed.fillPrice).toBeCloseTo(1.1002, 5);

      // Advance clock and update price.
      clock.advanceTo(2000);
      bars.set(key("EURUSD", "M15"), [bar(0, 1.1), bar(1000, 1.1), bar(2000, 1.105)]);

      const closed = await broker.closePosition(placed.ticket);
      // closeBid = 1.105, entryAsk = 1.1002
      // pips = (1.105 - 1.1002) / 0.0001 = 48
      // pnl = 48 * 0.1 * 10 = 48
      expect(closed.fillPrice).toBeCloseTo(1.105, 5);
      expect(closed.pnl).toBeCloseTo(48, 5);

      const account = await broker.getAccount();
      expect(account.balance).toBeCloseTo(10_048, 5);
    });

    it("sell: pnl sign correct (positive when price drops)", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("EURUSD", "M15"), [bar(1000, 1.1)]]]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 2 });
      const placed = await broker.placeOrder({
        symbol: "EURUSD",
        side: "sell",
        lotSize: 0.1,
        type: "market",
        sl: 1.105,
        tp: 1.095,
      });
      // sell fills at bid = 1.1
      expect(placed.fillPrice).toBeCloseTo(1.1, 5);

      clock.advanceTo(2000);
      bars.set(key("EURUSD", "M15"), [bar(1000, 1.1), bar(2000, 1.095)]);

      const closed = await broker.closePosition(placed.ticket);
      // sell closes at ask = 1.095 + 0.0002 = 1.0952
      // pips = (entry - close) / scale = (1.1 - 1.0952) / 0.0001 = 48
      // pnl = 48 * 0.1 * 10 = 48
      expect(closed.fillPrice).toBeCloseTo(1.0952, 5);
      expect(closed.pnl).toBeCloseTo(48, 5);
    });

    it("rejects non-market order types", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("EURUSD", "M15"), [bar(1000, 1.1)]]]);
      const broker = new FixtureBroker({ clock, bars });
      await expect(
        broker.placeOrder({
          symbol: "EURUSD",
          side: "buy",
          lotSize: 0.1,
          type: "limit",
          entry: 1.099,
          sl: 1.09,
          tp: 1.11,
        }),
      ).rejects.toThrow(/market/i);
    });

    it("rejects unknown ticket on close/modify", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("EURUSD", "M15"), [bar(1000, 1.1)]]]);
      const broker = new FixtureBroker({ clock, bars });
      await expect(broker.closePosition("nope")).rejects.toThrow(/not.*found/i);
      await expect(broker.modifyOrder({ ticket: "nope", sl: 1.0 })).rejects.toThrow(/not.*found/i);
    });
  });

  describe("getOpenPositions", () => {
    it("reflects opened positions and removes after close", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("EURUSD", "M15"), [bar(1000, 1.1)]]]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 1 });
      expect(await broker.getOpenPositions()).toHaveLength(0);

      const r1 = await broker.placeOrder({
        symbol: "EURUSD",
        side: "buy",
        lotSize: 0.1,
        type: "market",
        sl: 1.095,
        tp: 1.105,
      });
      const r2 = await broker.placeOrder({
        symbol: "EURUSD",
        side: "sell",
        lotSize: 0.1,
        type: "market",
        sl: 1.105,
        tp: 1.095,
      });
      expect(r1.ticket).not.toBe(r2.ticket);

      const open = await broker.getOpenPositions();
      expect(open).toHaveLength(2);

      await broker.closePosition(r1.ticket);
      expect(await broker.getOpenPositions()).toHaveLength(1);
    });
  });

  describe("modifyOrder", () => {
    it("updates sl/tp on an existing position", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("EURUSD", "M15"), [bar(1000, 1.1)]]]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 1 });
      const placed = await broker.placeOrder({
        symbol: "EURUSD",
        side: "buy",
        lotSize: 0.1,
        type: "market",
        sl: 1.095,
        tp: 1.105,
      });
      await broker.modifyOrder({ ticket: placed.ticket, sl: 1.097, tp: 1.107 });
      const open = await broker.getOpenPositions();
      expect(open[0]?.sl).toBeCloseTo(1.097, 5);
      expect(open[0]?.tp).toBeCloseTo(1.107, 5);
    });
  });

  describe("streamTicks", () => {
    it("yields a single tick per requested symbol", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([
        [key("EURUSD", "M15"), [bar(1000, 1.1)]],
        [key("USDJPY", "M15"), [bar(1000, 150.0)]],
      ]);
      const broker = new FixtureBroker({ clock, bars, spreadPips: 1 });
      const ticks = [];
      for await (const t of broker.streamTicks(["EURUSD", "USDJPY"])) {
        ticks.push(t);
      }
      expect(ticks).toHaveLength(2);
      expect(ticks[0]?.symbol).toBe("EURUSD");
      expect(ticks[1]?.symbol).toBe("USDJPY");
    });

    it("skips symbols with no bars", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>([[key("EURUSD", "M15"), [bar(1000, 1.1)]]]);
      const broker = new FixtureBroker({ clock, bars });
      const ticks = [];
      for await (const t of broker.streamTicks(["EURUSD", "GBPUSD"])) {
        ticks.push(t);
      }
      expect(ticks).toHaveLength(1);
    });
  });

  describe("getAccount", () => {
    it("uses startingBalance and accountCurrency defaults", async () => {
      const clock = new ReplayClock(1000);
      const bars = new Map<string, readonly Candle[]>();
      const broker = new FixtureBroker({ clock, bars });
      const account = await broker.getAccount();
      expect(account.balance).toBe(10_000);
      expect(account.equity).toBe(10_000);
      expect(account.currency).toBe("USD");
      expect(account.ts).toBe(1000);
    });

    it("respects custom startingBalance and accountCurrency", async () => {
      const clock = new ReplayClock(0);
      const bars = new Map<string, readonly Candle[]>();
      const broker = new FixtureBroker({
        clock,
        bars,
        startingBalance: 25_000,
        accountCurrency: "EUR",
      });
      const account = await broker.getAccount();
      expect(account.balance).toBe(25_000);
      expect(account.currency).toBe("EUR");
    });
  });
});
