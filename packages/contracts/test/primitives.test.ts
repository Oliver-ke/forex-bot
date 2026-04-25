import { describe, expect, it } from "vitest";
import {
  CurrencySchema,
  PipsSchema,
  PriceSchema,
  SymbolSchema,
  LotSizeSchema,
} from "../src/primitives.js";

describe("primitives", () => {
  it("Symbol accepts known FX/metal symbols", () => {
    expect(SymbolSchema.parse("EURUSD")).toBe("EURUSD");
    expect(SymbolSchema.parse("XAUUSD")).toBe("XAUUSD");
    expect(() => SymbolSchema.parse("eurusd")).toThrow();
    expect(() => SymbolSchema.parse("EUR/USD")).toThrow();
  });

  it("Currency accepts ISO codes", () => {
    expect(CurrencySchema.parse("USD")).toBe("USD");
    expect(() => CurrencySchema.parse("usd")).toThrow();
    expect(() => CurrencySchema.parse("US")).toThrow();
  });

  it("Price is a positive finite number", () => {
    expect(PriceSchema.parse(1.0845)).toBe(1.0845);
    expect(() => PriceSchema.parse(0)).toThrow();
    expect(() => PriceSchema.parse(-1)).toThrow();
    expect(() => PriceSchema.parse(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("Pips is a non-negative number", () => {
    expect(PipsSchema.parse(0)).toBe(0);
    expect(PipsSchema.parse(15.5)).toBe(15.5);
    expect(() => PipsSchema.parse(-0.1)).toThrow();
  });

  it("LotSize is between 0.01 and 100 in 0.01 steps", () => {
    expect(LotSizeSchema.parse(0.01)).toBe(0.01);
    expect(LotSizeSchema.parse(2)).toBe(2);
    expect(() => LotSizeSchema.parse(0)).toThrow();
    expect(() => LotSizeSchema.parse(101)).toThrow();
    expect(() => LotSizeSchema.parse(0.005)).toThrow();
  });
});
