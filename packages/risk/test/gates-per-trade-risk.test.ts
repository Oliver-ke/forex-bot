import { describe, expect, it } from "vitest";
import { perTradeRiskGate } from "../src/gates/per-trade-risk.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("perTradeRiskGate", () => {
  it("blocks when SL too tight (< minStopDistanceAtr × atrPips)", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 40,
        // entry 1.08, sl 1.0799 → 1 pip stop < 0.5 * 40 = 20 pips
        order: { ...mkGateCtx().order, entry: 1.08, sl: 1.0799, tp: 1.09 },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/stop/i);
  });

  it("blocks when RR < minRR", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 10,
        // stop 50 pips, tp 30 pips → RR 0.6 < 1.5
        order: { ...mkGateCtx().order, entry: 1.08, sl: 1.075, tp: 1.083 },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/RR/i);
  });

  it("passes on a normal setup", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 10,
        order: { ...mkGateCtx().order, entry: 1.08, sl: 1.075, tp: 1.0875 }, // 50 pip stop, 75 pip tp → RR 1.5
      }),
    );
    expect(r.pass).toBe(true);
  });

  it("uses JPY pip scale (0.01) for JPY pairs", () => {
    const r = perTradeRiskGate(
      mkGateCtx({
        atrPips: 10,
        // JPY pair: pipScale=0.01. entry=150.00, sl=149.50 → 50 pips. tp=150.75 → 75 pips. RR=1.5
        order: { ...mkGateCtx().order, symbol: "USDJPY", entry: 150.0, sl: 149.5, tp: 150.75 },
      }),
    );
    expect(r.pass).toBe(true);
  });
});
