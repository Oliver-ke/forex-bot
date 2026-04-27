import type { Position } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { reconcile } from "../src/reconcile.js";

function pos(id: string, symbol: "EURUSD" | "GBPUSD" = "EURUSD"): Position {
  return {
    id,
    symbol,
    side: "buy",
    lotSize: 0.1,
    entry: 1.08,
    sl: 1.07,
    tp: 1.09,
    openedAt: 1,
  };
}

describe("reconcile", () => {
  it("reports no divergence when sets match", () => {
    const r = reconcile({
      expected: [pos("T1"), pos("T2")],
      observed: [pos("T1"), pos("T2")],
    });
    expect(r.divergent).toBe(false);
    expect(r.missing).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it("flags missing tickets (we expected, broker doesn't have)", () => {
    const r = reconcile({
      expected: [pos("T1"), pos("T2")],
      observed: [pos("T1")],
    });
    expect(r.divergent).toBe(true);
    expect(r.missing.map((p) => p.id)).toEqual(["T2"]);
  });

  it("flags extra tickets (broker has, we don't expect)", () => {
    const r = reconcile({
      expected: [pos("T1")],
      observed: [pos("T1"), pos("T9")],
    });
    expect(r.divergent).toBe(true);
    expect(r.extra.map((p) => p.id)).toEqual(["T9"]);
  });

  it("flags drift when SL/TP disagree on the same ticket", () => {
    const local = pos("T1");
    const remote = { ...pos("T1"), sl: 1.05 };
    const r = reconcile({ expected: [local], observed: [remote] });
    expect(r.divergent).toBe(true);
    expect(r.drifted.map((d) => d.id)).toEqual(["T1"]);
  });
});
