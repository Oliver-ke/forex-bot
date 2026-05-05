import type { Broker } from "@forex-bot/broker-core";
import type { Position } from "@forex-bot/contracts";
import type { LlmUsage } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { BudgetTracker, PositionCap, assertDemoBroker } from "../src/guards.js";

function brokerWithDemo(isDemo: boolean): Broker {
  // Minimal Broker stub — only `isDemo` is read by `assertDemoBroker`.
  return { isDemo } as unknown as Broker;
}

function position(id: string, lotSize: number): Position {
  return {
    id,
    symbol: "EURUSD",
    side: "buy",
    lotSize,
    entry: 1.1,
    sl: 1.09,
    tp: 1.11,
    openedAt: 0,
  };
}

function usage(input: number, output: number, cacheRead = 0): LlmUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: 0,
  };
}

describe("assertDemoBroker", () => {
  it("throws when broker.isDemo is false", () => {
    expect(() => assertDemoBroker(brokerWithDemo(false))).toThrow(/demo broker/);
  });

  it("does not throw when broker.isDemo is true", () => {
    expect(() => assertDemoBroker(brokerWithDemo(true))).not.toThrow();
  });
});

describe("BudgetTracker", () => {
  it("starts at zero spend, not tripped", () => {
    const t = new BudgetTracker({ maxUsd: 10 });
    expect(t.spendUsd).toBe(0);
    expect(t.tripped).toBe(false);
  });

  it("1M input + 1M output costs $18 at default rates and stays under maxUsd=20", () => {
    const t = new BudgetTracker({ maxUsd: 20 });
    t.onUsage(usage(1_000_000, 1_000_000));
    // 300 cents/M * 1M + 1500 cents/M * 1M = 300 + 1500 = 1800 cents = $18.00
    expect(t.spendUsd).toBeCloseTo(18, 6);
    expect(t.tripped).toBe(false);
  });

  it("trips once cumulative spend reaches maxUsd", () => {
    const t = new BudgetTracker({ maxUsd: 1 });
    t.onUsage(usage(1_000_000, 0)); // $3.00
    expect(t.tripped).toBe(true);
    expect(t.spendUsd).toBeCloseTo(3, 6);
  });

  it("subtracts cacheReadTokens from billable input", () => {
    const t = new BudgetTracker({ maxUsd: 100 });
    // 1M input - 1M cache reads → 0 billable input. Output 1M → 1500c = $15.
    t.onUsage(usage(1_000_000, 1_000_000, 1_000_000));
    expect(t.spendUsd).toBeCloseTo(15, 6);
  });

  it("never billable input goes negative when cacheRead > input", () => {
    const t = new BudgetTracker({ maxUsd: 100 });
    t.onUsage(usage(500_000, 0, 1_000_000));
    expect(t.spendUsd).toBe(0);
  });

  it("reset() clears state", () => {
    const t = new BudgetTracker({ maxUsd: 1 });
    t.onUsage(usage(1_000_000, 0));
    expect(t.tripped).toBe(true);
    t.reset();
    expect(t.spendUsd).toBe(0);
    expect(t.tripped).toBe(false);
  });
});

describe("PositionCap", () => {
  it("returns false when sum stays under cap", () => {
    const cap = new PositionCap({ maxAggregateLots: 1.0 });
    expect(cap.wouldExceed([], 0.5)).toBe(false);
  });

  it("returns true when sum exceeds cap", () => {
    const cap = new PositionCap({ maxAggregateLots: 1.0 });
    const open = [position("a", 0.5), position("b", 0.3)];
    expect(cap.wouldExceed(open, 0.5)).toBe(true);
  });

  it("returns false when sum equals cap exactly", () => {
    const cap = new PositionCap({ maxAggregateLots: 1.0 });
    const open = [position("a", 0.5)];
    expect(cap.wouldExceed(open, 0.5)).toBe(false);
  });
});
