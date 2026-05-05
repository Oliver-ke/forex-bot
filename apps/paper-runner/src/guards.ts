import type { Broker } from "@forex-bot/broker-core";
import type { Position } from "@forex-bot/contracts";
import type { LlmUsage } from "@forex-bot/llm-provider";

/** Throws if the broker is not connected to a demo account. */
export function assertDemoBroker(broker: Broker): void {
  if (!broker.isDemo) {
    throw new Error(
      "paper-runner requires a demo broker; refusing to operate against a non-demo account",
    );
  }
}

export interface BudgetTrackerOpts {
  /** Cents per million input tokens. */
  inputCentsPerM?: number;
  /** Cents per million output tokens. */
  outputCentsPerM?: number;
  /** Max USD spend before tripping. */
  maxUsd: number;
}

export class BudgetTracker {
  readonly maxUsd: number;
  private cents = 0;
  private _tripped = false;
  private readonly inputCentsPerM: number;
  private readonly outputCentsPerM: number;

  constructor(opts: BudgetTrackerOpts) {
    this.maxUsd = opts.maxUsd;
    this.inputCentsPerM = opts.inputCentsPerM ?? 300;
    this.outputCentsPerM = opts.outputCentsPerM ?? 1500;
  }

  get tripped(): boolean {
    return this._tripped;
  }

  get spendUsd(): number {
    return this.cents / 100;
  }

  /** Hook compatible with LlmProvider.onUsage. */
  onUsage(u: LlmUsage): void {
    const billable = u.inputTokens - u.cacheReadTokens;
    const cents =
      Math.max(billable, 0) * (this.inputCentsPerM / 1_000_000) +
      u.outputTokens * (this.outputCentsPerM / 1_000_000);
    this.cents += cents;
    if (this.cents / 100 >= this.maxUsd) this._tripped = true;
  }

  /** Reset for tests / new billing cycles. */
  reset(): void {
    this.cents = 0;
    this._tripped = false;
  }
}

export interface PositionCapOpts {
  /** Aggregate notional ceiling, units = lotSize × pipValuePerLot × symbolFactor. Use a simple lotSize sum for v1. */
  maxAggregateLots: number;
}

export class PositionCap {
  readonly maxAggregateLots: number;

  constructor(opts: PositionCapOpts) {
    this.maxAggregateLots = opts.maxAggregateLots;
  }

  /** Returns true if adding `additionalLots` to current open positions would exceed the cap. */
  wouldExceed(currentOpen: readonly Position[], additionalLots: number): boolean {
    const sum = currentOpen.reduce((s, p) => s + p.lotSize, 0) + additionalLots;
    return sum > this.maxAggregateLots;
  }
}
