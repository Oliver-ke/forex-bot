import type { Broker } from "@forex-bot/broker-core";
import type { StateBundle, Symbol, TickTrigger } from "@forex-bot/contracts";
import type { HotCache } from "@forex-bot/data-core";

export interface AssembleStateInput {
  broker: Broker;
  cache: HotCache;
  symbol: Symbol;
  ts: number;
  trigger: TickTrigger;
  /** How far back to read headlines, in ms. Defaults to last 24h. */
  newsLookbackMs?: number;
  /** Per-timeframe candle depth. Defaults to 200. */
  candleLimit?: number;
}

export async function assembleState(input: AssembleStateInput): Promise<StateBundle> {
  const limit = input.candleLimit ?? 200;
  const lookback = input.newsLookbackMs ?? 24 * 60 * 60 * 1000;
  const [m15, h1, h4, d1, account, openPositions, headlines, calendar] = await Promise.all([
    input.broker.getCandles(input.symbol, "M15", limit),
    input.broker.getCandles(input.symbol, "H1", limit),
    input.broker.getCandles(input.symbol, "H4", limit),
    input.broker.getCandles(input.symbol, "D1", limit),
    input.broker.getAccount(),
    input.broker.getOpenPositions(),
    input.cache.recentHeadlines({ sinceMs: input.ts - lookback }),
    input.cache.getCalendarWindow(),
  ]);
  return {
    symbol: input.symbol,
    ts: input.ts,
    trigger: input.trigger,
    market: {
      symbol: input.symbol,
      M15: [...m15],
      H1: [...h1],
      H4: [...h4],
      D1: [...d1],
    },
    account,
    openPositions: [...openPositions],
    recentNews: [...headlines],
    upcomingEvents: [...calendar],
    regimePrior: { label: "trending", volBucket: "normal" },
  };
}
