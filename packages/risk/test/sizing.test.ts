import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeLotSize } from "../src/sizing.js";

describe("computeLotSize", () => {
  it("1% of $10k on EURUSD with 50 pip SL ≈ 0.20 lots", () => {
    const lot = computeLotSize({
      equity: 10000, riskPct: 1, stopDistancePips: 50, pipValuePerLot: 10, maxLotSize: 2,
    });
    expect(lot).toBeCloseTo(0.2, 2);
  });

  it("clamps to maxLotSize", () => {
    const lot = computeLotSize({
      equity: 10_000_000, riskPct: 1, stopDistancePips: 50, pipValuePerLot: 10, maxLotSize: 2,
    });
    expect(lot).toBe(2);
  });

  it("rounds down to 0.01 increments", () => {
    const lot = computeLotSize({
      equity: 10000, riskPct: 1, stopDistancePips: 123, pipValuePerLot: 10, maxLotSize: 5,
    });
    expect(Math.round(lot * 100) / 100).toBe(lot);
    expect(lot).toBeLessThan(0.09);
  });

  it("property: realized risk never exceeds riskPct × equity", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 100, noNaN: true, noDefaultInfinity: true }),
        (equity, riskPct, stopPips, pipValue) => {
          const lot = computeLotSize({
            equity, riskPct, stopDistancePips: stopPips, pipValuePerLot: pipValue, maxLotSize: 100,
          });
          const risk = lot * stopPips * pipValue;
          const cap = (riskPct / 100) * equity;
          return risk <= cap + 1e-6;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("returns 0 if stopDistancePips is 0 (refuse unsafe entry)", () => {
    expect(
      computeLotSize({ equity: 10000, riskPct: 1, stopDistancePips: 0, pipValuePerLot: 10, maxLotSize: 2 }),
    ).toBe(0);
  });
});
