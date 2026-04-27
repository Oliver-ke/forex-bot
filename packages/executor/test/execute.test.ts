import { FakeBroker } from "@forex-bot/broker-core";
import { describe, expect, it } from "vitest";
import { execute, type ExecuteInput } from "../src/execute.js";

const NOW = 1_700_000_000_000;

function mkInput(overrides: Partial<ExecuteInput> = {}): ExecuteInput {
  return {
    now: NOW,
    correlationId: "o-1",
    decision: {
      approve: true as const,
      lotSize: 0.1,
      sl: 1.075,
      tp: 1.085,
      expiresAt: NOW + 60_000,
      reasons: ["ok"],
    },
    order: {
      symbol: "EURUSD" as const,
      side: "buy" as const,
      lotSize: 0.1,
      entry: 1.08,
      sl: 1.075,
      tp: 1.085,
      expiresAt: NOW + 60_000,
    },
    preFire: {
      currentSpreadPips: 1.0,
      medianSpreadPips: 1.0,
      maxSpreadMultiplier: 2.0,
      freeMargin: 10_000,
      estimatedRequiredMargin: 500,
      feedAgeSec: 1,
      maxFeedAgeSec: 30,
    },
    ...overrides,
  };
}

function fb() {
  const b = new FakeBroker({
    accountCurrency: "USD",
    startingBalance: 10_000,
    pipScale: () => 0.0001,
    nowFn: () => NOW,
  });
  b.setQuote("EURUSD", 1.08, 1.0802);
  return b;
}

describe("execute", () => {
  it("submits and reports filled when broker fills", async () => {
    const broker = fb();
    const result = await execute(mkInput(), broker);
    expect(result.approved).toBe(true);
    expect(result.record.state).toBe("filled");
    expect(result.record.ticket).toBeDefined();
    expect(result.record.fillPrice).toBe(1.0802);
  });

  it("does not submit when pre-fire fails", async () => {
    const broker = fb();
    const input = mkInput({
      preFire: { ...mkInput().preFire, currentSpreadPips: 5 },
    });
    const result = await execute(input, broker);
    expect(result.approved).toBe(false);
    expect(result.record.state).toBe("pre_fire_failed");
    const open = await broker.getOpenPositions();
    expect(open).toHaveLength(0);
  });

  it("expires when now > decision.expiresAt", async () => {
    const broker = fb();
    const input = mkInput({ now: NOW + 70_000 });
    const result = await execute(input, broker);
    expect(result.record.state).toBe("expired");
    expect(result.approved).toBe(false);
  });

  it("rejects when broker throws", async () => {
    const broker = new FakeBroker({
      accountCurrency: "USD",
      startingBalance: 10_000,
      pipScale: () => 0.0001,
      nowFn: () => NOW,
    });
    const result = await execute(mkInput(), broker);
    expect(result.record.state).toBe("rejected");
    expect(result.record.rejectReason).toMatch(/no quote/i);
  });
});
