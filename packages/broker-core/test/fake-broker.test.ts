import { describe, expect, it } from "vitest";
import { FakeBroker } from "../src/fake-broker.js";

const NOW = 1_700_000_000_000;

function fb() {
  return new FakeBroker({
    accountCurrency: "USD",
    startingBalance: 10_000,
    pipScale: (s) => (s.endsWith("JPY") ? 0.01 : 0.0001),
    nowFn: () => NOW,
  });
}

describe("FakeBroker", () => {
  it("getAccount returns starting balance", async () => {
    const b = fb();
    const a = await b.getAccount();
    expect(a.equity).toBe(10_000);
    expect(a.currency).toBe("USD");
  });

  it("getQuote throws if no quote was set", async () => {
    const b = fb();
    await expect(b.getQuote("EURUSD")).rejects.toThrow(/no quote/i);
  });

  it("setQuote then getQuote returns a Tick with bid<=ask", async () => {
    const b = fb();
    b.setQuote("EURUSD", 1.0801, 1.0803);
    const t = await b.getQuote("EURUSD");
    expect(t.bid).toBe(1.0801);
    expect(t.ask).toBe(1.0803);
  });

  it("placeOrder market fills at ask for buy / bid for sell", async () => {
    const b = fb();
    b.setQuote("EURUSD", 1.08, 1.0802);
    const r1 = await b.placeOrder({
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      type: "market",
      sl: 1.075,
      tp: 1.085,
    });
    expect(r1.fillPrice).toBe(1.0802);
    const r2 = await b.placeOrder({
      symbol: "EURUSD",
      side: "sell",
      lotSize: 0.1,
      type: "market",
      sl: 1.085,
      tp: 1.075,
    });
    expect(r2.fillPrice).toBe(1.08);
    const open = await b.getOpenPositions();
    expect(open).toHaveLength(2);
  });

  it("closePosition realizes pnl in account currency", async () => {
    const b = fb();
    b.setQuote("EURUSD", 1.08, 1.0802);
    const r = await b.placeOrder({
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      type: "market",
      sl: 1.075,
      tp: 1.085,
    });
    b.setQuote("EURUSD", 1.0852, 1.0854);
    const close = await b.closePosition(r.ticket);
    // 0.1 lot × 50 pips × 10 USD/pip = 50 USD profit
    expect(close.pnl).toBeCloseTo(50, 5);
    expect(await b.getOpenPositions()).toHaveLength(0);
  });

  it("rejects unknown ticket on close", async () => {
    const b = fb();
    await expect(b.closePosition("nope")).rejects.toThrow(/not.*found/i);
  });
});
