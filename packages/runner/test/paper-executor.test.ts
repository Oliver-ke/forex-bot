import type { Broker } from "@forex-bot/broker-core";
import type {
  ClosePositionResult,
  ModifyOrderRequest,
  PlaceOrderRequest,
  PlaceOrderResult,
} from "@forex-bot/broker-core";
import type { AccountState, Candle, Position, Symbol, Tick, Timeframe } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { PaperExecutor } from "../src/paper-executor.js";
import type { OpenIntent } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bar(ts: number, close: number, opts: { high?: number; low?: number } = {}): Candle {
  const spread = 0.0005;
  const high = opts.high ?? close + spread;
  const low = opts.low ?? close - spread;
  return { ts, open: close, high, low, close, volume: 1 };
}

/** Minimal fake broker that returns preset candles for H1 calls only. */
function makeBroker(h1Candles: Candle[]): Broker {
  return {
    isDemo: true,
    async getCandles(
      _symbol: Symbol,
      _timeframe: Timeframe,
      _limit: number,
    ): Promise<readonly Candle[]> {
      return h1Candles;
    },
    async getQuote(_symbol: Symbol): Promise<Tick> {
      throw new Error("not implemented");
    },
    async getAccount(): Promise<AccountState> {
      throw new Error("not implemented");
    },
    async getOpenPositions(): Promise<readonly Position[]> {
      throw new Error("not implemented");
    },
    async placeOrder(_req: PlaceOrderRequest): Promise<PlaceOrderResult> {
      throw new Error("not implemented");
    },
    async modifyOrder(_req: ModifyOrderRequest): Promise<void> {
      throw new Error("not implemented");
    },
    async closePosition(_ticket: string): Promise<ClosePositionResult> {
      throw new Error("not implemented");
    },
    async *streamTicks(_symbols: readonly Symbol[]): AsyncIterable<Tick> {
      yield* [] as Tick[];
      throw new Error("not implemented");
    },
  };
}

/**
 * Build a minimal OpenIntent for a EURUSD buy.
 * entry is derived from bundle.market.M15.at(-1).close, so we set it to 1.08.
 */
function makeIntent(
  openedAt: number,
  sl = 1.079,
  tp = 1.082,
  analysts?: OpenIntent["analysts"],
): OpenIntent {
  const decision = {
    approve: true as const,
    lotSize: 0.05,
    sl,
    tp,
    expiresAt: openedAt + 24 * 60 * 60_000,
    reasons: ["test"],
  };

  const m15Bar = bar(openedAt - 15 * 60_000, 1.08);
  const h1Bar = bar(openedAt - 60 * 60_000, 1.079);
  const h4Bar = bar(openedAt - 4 * 60 * 60_000, 1.078);
  const d1Bar = bar(openedAt - 24 * 60 * 60_000, 1.077);

  const bundle = {
    symbol: "EURUSD" as Symbol,
    ts: openedAt,
    trigger: { reason: "schedule" as const },
    market: {
      symbol: "EURUSD" as Symbol,
      M15: [m15Bar],
      H1: [h1Bar],
      H4: [h4Bar],
      D1: [d1Bar],
    },
    account: {
      ts: openedAt,
      balance: 10_000,
      equity: 10_000,
      freeMargin: 9_000,
      usedMargin: 1_000,
      marginLevelPct: 1000,
      currency: "USD",
    },
    openPositions: [],
    recentNews: [],
    upcomingEvents: [],
    regimePrior: { label: "trending" as const, volBucket: "normal" as const },
  };

  return {
    symbol: "EURUSD" as Symbol,
    now: openedAt,
    decision,
    bundle,
    pipValuePerLot: 10,
    ...(analysts ? { analysts } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000_000; // arbitrary epoch ms (weekday london session)

describe("PaperExecutor", () => {
  it("SL hit: open buy, reconcile with low ≤ sl → exitReason=sl, pnl<0, realizedR≈-1", async () => {
    // entry=1.08, sl=1.079, tp=1.082
    // bar after open has low <= 1.079 → SL triggered, exit=1.079
    const afterOpen = BASE_TS + 60_000;
    const candles = [bar(afterOpen, 1.079, { low: 1.079 })];

    const broker = makeBroker(candles);
    const exec = new PaperExecutor(broker);

    const intent = makeIntent(BASE_TS);
    await exec.open(intent);

    const closed = await exec.reconcile(BASE_TS + 120_000);

    expect(closed.length).toBe(1);
    const trade = closed[0];
    expect(trade).toBeDefined();
    if (!trade) return;

    expect(trade.exitReason).toBe("sl");
    expect(trade.pnl).toBeLessThan(0);
    // realizedR = ((exit - entry) * direction) / stopDist
    // = ((1.079 - 1.08) * 1) / |1.08 - 1.079| = -0.001 / 0.001 = -1
    expect(trade.realizedR).toBeCloseTo(-1, 5);
  });

  it("TP hit: open buy, reconcile with high ≥ tp (no prior SL) → exitReason=tp, pnl>0", async () => {
    const afterOpen = BASE_TS + 60_000;
    // high >= 1.082, low does NOT touch sl 1.079
    const candles = [bar(afterOpen, 1.082, { high: 1.082, low: 1.081 })];

    const broker = makeBroker(candles);
    const exec = new PaperExecutor(broker);

    const intent = makeIntent(BASE_TS);
    await exec.open(intent);

    const closed = await exec.reconcile(BASE_TS + 120_000);

    expect(closed.length).toBe(1);
    const trade = closed[0];
    expect(trade).toBeDefined();
    if (!trade) return;

    expect(trade.exitReason).toBe("tp");
    expect(trade.pnl).toBeGreaterThan(0);
  });

  it("Still open: candles never touch sl/tp → reconcile returns [], second reconcile with closing candle emits trade", async () => {
    // Candles that don't trigger SL or TP
    const afterOpen1 = BASE_TS + 60_000;
    const afterOpen2 = BASE_TS + 120_000;
    const afterOpen3 = BASE_TS + 180_000;

    // First reconcile: neutral candles
    const neutralCandles = [bar(afterOpen1, 1.0805, { high: 1.081, low: 1.0801 })];
    let brokersCandles = neutralCandles;
    const broker: Broker = {
      isDemo: true,
      async getCandles(): Promise<readonly Candle[]> {
        return brokersCandles;
      },
      async getQuote(): Promise<Tick> {
        throw new Error("not implemented");
      },
      async getAccount(): Promise<AccountState> {
        throw new Error("not implemented");
      },
      async getOpenPositions(): Promise<readonly Position[]> {
        throw new Error("not implemented");
      },
      async placeOrder(): Promise<PlaceOrderResult> {
        throw new Error("not implemented");
      },
      async modifyOrder(): Promise<void> {
        throw new Error("not implemented");
      },
      async closePosition(): Promise<ClosePositionResult> {
        throw new Error("not implemented");
      },
      async *streamTicks(): AsyncIterable<Tick> {
        yield* [] as Tick[];
        throw new Error("not implemented");
      },
    };

    const exec = new PaperExecutor(broker);
    const intent = makeIntent(BASE_TS);
    await exec.open(intent);

    // First reconcile: no close
    const firstClosed = await exec.reconcile(afterOpen2);
    expect(firstClosed.length).toBe(0);

    // Verify position still open (cumulativeTrades still 0)
    expect(exec.cumulativeTrades.length).toBe(0);

    // Second reconcile with TP-hitting candle
    brokersCandles = [
      bar(afterOpen1, 1.0805, { high: 1.081, low: 1.0801 }),
      bar(afterOpen2, 1.0805, { high: 1.081, low: 1.0801 }),
      bar(afterOpen3, 1.082, { high: 1.082, low: 1.0818 }),
    ];
    const secondClosed = await exec.reconcile(afterOpen3 + 60_000);
    expect(secondClosed.length).toBe(1);
    expect(secondClosed[0]?.exitReason).toBe("tp");
  });

  it("Getter: after a close, cumulativeTrades.length===1, sessions and regimes are defined", async () => {
    const afterOpen = BASE_TS + 60_000;
    const candles = [bar(afterOpen, 1.082, { high: 1.082, low: 1.081 })];

    const broker = makeBroker(candles);
    const exec = new PaperExecutor(broker);

    const intent = makeIntent(BASE_TS);
    await exec.open(intent);

    const closed = await exec.reconcile(BASE_TS + 120_000);
    expect(closed.length).toBe(1);
    const trade = closed[0];
    expect(trade).toBeDefined();
    if (!trade) return;

    expect(exec.cumulativeTrades.length).toBe(1);
    expect(exec.sessions.get(trade)).toBeDefined();
    expect(exec.regimes.get(trade)).toBeDefined();
  });

  it("analysts parity: analysts on the OpenIntent flow through onto the ClosedTrade", async () => {
    const afterOpen = BASE_TS + 60_000;
    const candles = [bar(afterOpen, 1.082, { high: 1.082, low: 1.081 })];

    const broker = makeBroker(candles);
    const exec = new PaperExecutor(broker);

    const analysts = [
      {
        source: "technical" as const,
        bias: "long" as const,
        conviction: 0.8,
        reasoning: "x",
        evidence: [],
      },
    ];
    const intent = makeIntent(BASE_TS, 1.079, 1.082, analysts);
    await exec.open(intent);

    const closed = await exec.reconcile(BASE_TS + 120_000);
    expect(closed.length).toBe(1);
    // Approved trades must carry analysts through to the journal (parity with
    // the decisions stream — regression guard for the lost-fix incident).
    expect(closed[0]?.analysts).toBeDefined();
    expect(closed[0]?.analysts?.length).toBe(1);
    expect(closed[0]?.analysts?.[0]?.source).toBe("technical");
  });
});
