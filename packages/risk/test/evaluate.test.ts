import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { KillSwitch } from "../src/kill-switch.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("evaluate (9-gate chain)", () => {
  it("returns first failing gate (short-circuits)", () => {
    const ks = new KillSwitch();
    ks.tripManual("test");
    const r = evaluate(mkGateCtx({ killSwitch: ks }));
    expect(r.approve).toBe(false);
    if (!r.approve) expect(r.vetoReason).toMatch(/kill-switch/);
  });

  it("approves when all 9 gates pass", () => {
    const r = evaluate(mkGateCtx({
      atrPips: 10,
      order: { ...mkGateCtx().order, entry: 1.08, sl: 1.075, tp: 1.0875 },
    }));
    expect(r.approve).toBe(true);
    if (r.approve) {
      expect(r.lotSize).toBeGreaterThan(0);
      expect(r.reasons.length).toBe(9);
    }
  });

  it("rejects with sizing veto when stop distance is zero", () => {
    const ctx = mkGateCtx();
    const r = evaluate({ ...ctx, order: { ...ctx.order, sl: ctx.order.entry } });
    expect(r.approve).toBe(false);
    if (!r.approve) expect(r.vetoReason).toMatch(/sizing/);
  });
});
