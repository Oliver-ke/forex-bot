import { describe, expect, it } from "vitest";
import { sessionGate } from "../src/gates/session.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("sessionGate", () => {
  it("blocks EURUSD during Asia (allowed is a restricted list)", () => {
    const r = sessionGate(mkGateCtx({ session: "asia", order: { ...mkGateCtx().order, symbol: "EURUSD" } }));
    expect(r.pass).toBe(false);
  });

  it("allows USDJPY during Asia", () => {
    const r = sessionGate(mkGateCtx({ session: "asia", order: { ...mkGateCtx().order, symbol: "USDJPY" } }));
    expect(r.pass).toBe(true);
  });

  it("allows any symbol during London (allowed=all)", () => {
    const r = sessionGate(mkGateCtx({ session: "london", order: { ...mkGateCtx().order, symbol: "EURUSD" } }));
    expect(r.pass).toBe(true);
  });

  it("blocks during off-session", () => {
    const r = sessionGate(mkGateCtx({ session: "off" }));
    expect(r.pass).toBe(false);
  });

  it("allows during NY session (allowed=all)", () => {
    const r = sessionGate(mkGateCtx({ session: "ny" }));
    expect(r.pass).toBe(true);
  });

  it("treats overlap_ny_london as all-allowed", () => {
    const r = sessionGate(mkGateCtx({ session: "overlap_ny_london" }));
    expect(r.pass).toBe(true);
  });
});
