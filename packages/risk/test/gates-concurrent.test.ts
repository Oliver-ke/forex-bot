import type { Position } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { concurrentPositionsGate } from "../src/gates/concurrent.js";
import { mkGateCtx } from "./helpers/ctx.js";

function dummy(idx: number): Position {
  return {
    id: `p-${idx}`,
    symbol: "EURUSD",
    side: "buy",
    lotSize: 0.1,
    entry: 1,
    sl: 0.99,
    tp: 1.01,
    openedAt: 0,
  };
}

describe("concurrentPositionsGate", () => {
  it("passes when under cap", () => {
    const r = concurrentPositionsGate(mkGateCtx({ openPositions: [dummy(1), dummy(2)] }));
    expect(r.pass).toBe(true);
  });

  it("blocks when at cap", () => {
    const r = concurrentPositionsGate(
      mkGateCtx({ openPositions: [dummy(1), dummy(2), dummy(3), dummy(4)] }),
    );
    expect(r.pass).toBe(false);
  });
});
