import { describe, expect, it } from "vitest";
import { defaultRiskConfig, type Position } from "@forex-bot/contracts";
import { correlationGate } from "../src/gates/correlation.js";
import { CorrelationMatrix } from "../src/correlation.js";
import { mkGateCtx } from "./helpers/ctx.js";

const mat = new CorrelationMatrix({ EURUSD: { GBPUSD: 0.9 }, GBPUSD: { EURUSD: 0.9 } });

// Lower correlation cap so a 2% net (1% new + 1% existing) exceeds it.
const tightConfig = {
  ...defaultRiskConfig,
  correlation: { ...defaultRiskConfig.correlation, maxNetCorrelatedExposurePct: 1.5 },
};

function p(symbol: "EURUSD" | "GBPUSD", side: "buy" | "sell"): Position {
  return {
    id: `${symbol}-${side}`,
    symbol,
    side,
    lotSize: 0.1,
    entry: 1,
    sl: side === "buy" ? 0.9 : 1.1,
    tp: side === "buy" ? 1.1 : 0.9,
    openedAt: 0,
  };
}

describe("correlationGate", () => {
  it("blocks when net correlated exposure would exceed cap", () => {
    const r = correlationGate(
      mkGateCtx({
        config: tightConfig,
        correlation: mat,
        openPositions: [p("GBPUSD", "buy")],
      }),
    );
    expect(r.pass).toBe(false);
  });

  it("passes when opposite direction offsets", () => {
    const r = correlationGate(
      mkGateCtx({
        config: tightConfig,
        correlation: mat,
        openPositions: [p("GBPUSD", "sell")],
      }),
    );
    expect(r.pass).toBe(true);
  });
});
