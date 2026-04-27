import { describe, expect, it } from "vitest";
import { FakeBroker } from "../src/fake-broker.js";

describe("FakeBroker.streamTicks", () => {
  it("emits one tick per symbol and completes", async () => {
    const b = new FakeBroker({
      accountCurrency: "USD",
      startingBalance: 10_000,
      pipScale: () => 0.0001,
    });
    b.setQuote("EURUSD", 1.08, 1.0802);
    b.setQuote("GBPUSD", 1.27, 1.2702);
    const out: string[] = [];
    for await (const t of b.streamTicks(["EURUSD", "GBPUSD"])) {
      out.push(t.symbol);
    }
    expect(out).toEqual(["EURUSD", "GBPUSD"]);
  });

  it("skips symbols without quotes", async () => {
    const b = new FakeBroker({
      accountCurrency: "USD",
      startingBalance: 10_000,
      pipScale: () => 0.0001,
    });
    b.setQuote("EURUSD", 1.08, 1.0802);
    const out: string[] = [];
    for await (const t of b.streamTicks(["EURUSD", "XAUUSD"])) {
      out.push(t.symbol);
    }
    expect(out).toEqual(["EURUSD"]);
  });
});
