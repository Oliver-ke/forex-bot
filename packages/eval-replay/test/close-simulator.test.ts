import type { Candle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { type SimulatedPosition, simulateClose } from "../src/close-simulator.js";

function bar(ts: number, open: number, high: number, low: number, close: number): Candle {
  return { ts, open, high, low, close, volume: 1 };
}

describe("simulateClose", () => {
  describe("buy", () => {
    const buy: SimulatedPosition = {
      side: "buy",
      entry: 1.1,
      sl: 1.09,
      tp: 1.11,
    };

    it("returns TP fill when only TP is touched", () => {
      const bars: Candle[] = [
        bar(1000, 1.1, 1.105, 1.095, 1.1), // neither
        bar(2000, 1.1, 1.115, 1.099, 1.112), // tp only (low 1.099 > sl 1.09)
      ];
      const out = simulateClose(buy, bars);
      expect(out.reason).toBe("tp");
      expect(out.exit).toBe(1.11);
      expect(out.closedAt).toBe(2000);
      expect(out.barIndex).toBe(1);
    });

    it("returns SL fill when only SL is touched", () => {
      const bars: Candle[] = [
        bar(1000, 1.1, 1.105, 1.095, 1.1), // neither
        bar(2000, 1.1, 1.105, 1.085, 1.092), // sl only (high 1.105 < tp 1.11)
      ];
      const out = simulateClose(buy, bars);
      expect(out.reason).toBe("sl");
      expect(out.exit).toBe(1.09);
      expect(out.closedAt).toBe(2000);
      expect(out.barIndex).toBe(1);
    });

    it("returns SL when both are touched in same bar (pessimistic)", () => {
      const bars: Candle[] = [
        bar(1000, 1.1, 1.115, 1.085, 1.1), // both
      ];
      const out = simulateClose(buy, bars);
      expect(out.reason).toBe("sl");
      expect(out.exit).toBe(1.09);
      expect(out.barIndex).toBe(0);
    });
  });

  describe("sell", () => {
    const sell: SimulatedPosition = {
      side: "sell",
      entry: 1.1,
      sl: 1.11,
      tp: 1.09,
    };

    it("returns TP fill when only TP is touched", () => {
      const bars: Candle[] = [
        bar(1000, 1.1, 1.105, 1.095, 1.1), // neither
        bar(2000, 1.1, 1.105, 1.085, 1.092), // tp only (high 1.105 < sl 1.11)
      ];
      const out = simulateClose(sell, bars);
      expect(out.reason).toBe("tp");
      expect(out.exit).toBe(1.09);
      expect(out.closedAt).toBe(2000);
      expect(out.barIndex).toBe(1);
    });

    it("returns SL fill when only SL is touched", () => {
      const bars: Candle[] = [
        bar(1000, 1.1, 1.105, 1.095, 1.1), // neither
        bar(2000, 1.1, 1.115, 1.099, 1.108), // sl only (low 1.099 > tp 1.09)
      ];
      const out = simulateClose(sell, bars);
      expect(out.reason).toBe("sl");
      expect(out.exit).toBe(1.11);
      expect(out.closedAt).toBe(2000);
      expect(out.barIndex).toBe(1);
    });

    it("returns SL when both are touched in same bar (pessimistic)", () => {
      const bars: Candle[] = [
        bar(1000, 1.1, 1.115, 1.085, 1.1), // both
      ];
      const out = simulateClose(sell, bars);
      expect(out.reason).toBe("sl");
      expect(out.exit).toBe(1.11);
      expect(out.barIndex).toBe(0);
    });
  });

  it("returns 'none' with last bar close when nothing triggers and no expiry", () => {
    const buy: SimulatedPosition = { side: "buy", entry: 1.1, sl: 1.09, tp: 1.11 };
    const bars: Candle[] = [bar(1000, 1.1, 1.105, 1.095, 1.1), bar(2000, 1.1, 1.108, 1.092, 1.107)];
    const out = simulateClose(buy, bars);
    expect(out.reason).toBe("none");
    expect(out.exit).toBe(1.107);
    expect(out.closedAt).toBe(2000);
    expect(out.barIndex).toBe(1);
  });

  it("returns 'expiry' at the bar where ts >= expiresAt", () => {
    const buy: SimulatedPosition = {
      side: "buy",
      entry: 1.1,
      sl: 1.09,
      tp: 1.11,
      expiresAt: 2500,
    };
    const bars: Candle[] = [
      bar(1000, 1.1, 1.105, 1.095, 1.1),
      bar(2000, 1.1, 1.108, 1.092, 1.107),
      bar(3000, 1.107, 1.109, 1.099, 1.105), // ts >= 2500, no SL/TP
    ];
    const out = simulateClose(buy, bars);
    expect(out.reason).toBe("expiry");
    expect(out.exit).toBe(1.105);
    expect(out.closedAt).toBe(3000);
    expect(out.barIndex).toBe(2);
  });

  it("SL/TP take precedence over expiry on the same bar", () => {
    const buy: SimulatedPosition = {
      side: "buy",
      entry: 1.1,
      sl: 1.09,
      tp: 1.11,
      expiresAt: 2000,
    };
    const bars: Candle[] = [
      bar(1000, 1.1, 1.105, 1.095, 1.1),
      bar(2000, 1.1, 1.115, 1.099, 1.112), // tp + ts >= expiry → tp wins
    ];
    const out = simulateClose(buy, bars);
    expect(out.reason).toBe("tp");
    expect(out.exit).toBe(1.11);
    expect(out.barIndex).toBe(1);
  });

  it("throws on empty bars", () => {
    const buy: SimulatedPosition = { side: "buy", entry: 1.1, sl: 1.09, tp: 1.11 };
    expect(() => simulateClose(buy, [])).toThrow(/bars must not be empty/);
  });

  it("uses earliest triggering bar (does not scan further)", () => {
    const buy: SimulatedPosition = { side: "buy", entry: 1.1, sl: 1.09, tp: 1.11 };
    const bars: Candle[] = [
      bar(1000, 1.1, 1.115, 1.099, 1.11), // tp at bar 0
      bar(2000, 1.11, 1.12, 1.085, 1.1), // would be sl
    ];
    const out = simulateClose(buy, bars);
    expect(out.reason).toBe("tp");
    expect(out.barIndex).toBe(0);
    expect(out.closedAt).toBe(1000);
  });
});
