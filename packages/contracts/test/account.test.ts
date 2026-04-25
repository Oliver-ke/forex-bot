import { describe, expect, it } from "vitest";
import {
  AccountStateSchema,
  PositionSchema,
  PendingOrderSchema,
} from "../src/account.js";

describe("account types", () => {
  it("AccountState requires equity > 0 and balance >= 0", () => {
    const a = AccountStateSchema.parse({
      ts: 1,
      currency: "USD",
      balance: 10000,
      equity: 10050,
      freeMargin: 9500,
      usedMargin: 500,
      marginLevelPct: 2010,
    });
    expect(a.equity).toBe(10050);
    expect(() =>
      AccountStateSchema.parse({
        ts: 1,
        currency: "USD",
        balance: 0,
        equity: 0,
        freeMargin: 0,
        usedMargin: 0,
        marginLevelPct: 0,
      }),
    ).toThrow();
  });

  it("Position requires SL and TP on correct sides of entry", () => {
    const base = {
      id: "p-1",
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.5,
      entry: 1.08,
      openedAt: 1,
    } as const;
    expect(PositionSchema.parse({ ...base, sl: 1.07, tp: 1.09 }).side).toBe("buy");
    expect(() => PositionSchema.parse({ ...base, sl: 1.09, tp: 1.07 })).toThrow();
  });

  it("Position sell side: SL above entry, TP below entry", () => {
    const sellBase = {
      id: "p-2",
      symbol: "EURUSD",
      side: "sell",
      lotSize: 0.5,
      entry: 1.08,
      openedAt: 1,
    } as const;
    expect(PositionSchema.parse({ ...sellBase, sl: 1.09, tp: 1.07 }).side).toBe("sell");
    expect(() => PositionSchema.parse({ ...sellBase, sl: 1.07, tp: 1.09 })).toThrow();
  });

  it("PendingOrder requires expiry >= now", () => {
    expect(() =>
      PendingOrderSchema.parse({
        symbol: "EURUSD",
        side: "buy",
        lotSize: 0.1,
        entry: 1.08,
        sl: 1.07,
        tp: 1.09,
        expiresAt: 0,
      }),
    ).not.toThrow();
  });
});
