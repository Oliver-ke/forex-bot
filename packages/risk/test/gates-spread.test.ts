import { describe, expect, it } from "vitest";
import { spreadGate } from "../src/gates/spread.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("spreadGate", () => {
  it("passes when current spread <= median × multiplier", () => {
    const r = spreadGate(mkGateCtx({ currentSpreadPips: 1.8, medianSpreadPips: 1.0 }));
    expect(r.pass).toBe(true);
  });

  it("blocks when current spread > median × multiplier", () => {
    const r = spreadGate(mkGateCtx({ currentSpreadPips: 3, medianSpreadPips: 1.0 }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/spread/i);
  });
});
