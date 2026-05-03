import {
  type Broker,
  BrokerNotFoundError,
  BrokerRejectedError,
  type ClosePositionResult,
  type ModifyOrderRequest,
  type PlaceOrderRequest,
  type PlaceOrderResult,
} from "@forex-bot/broker-core";
import type { AccountState, Candle, Position, Symbol, Tick, Timeframe } from "@forex-bot/contracts";
import type { ReplayClock } from "@forex-bot/eval-core";

export interface FixtureBrokerOpts {
  clock: ReplayClock;
  /** Bars per (symbol, timeframe). Used for getCandles + entry-fill price. Key: `${symbol}:${timeframe}`. */
  bars: Map<string, readonly Candle[]>;
  /** Spread in pips applied between bid (close) and ask (close + spread*pipScale). */
  spreadPips?: number;
  /** Pip size per symbol. Default 0.0001 except XXX/JPY -> 0.01. */
  pipScale?: (symbol: Symbol) => number;
  accountCurrency?: string;
  startingBalance?: number;
  pipValuePerLot?: number;
}

export function defaultPipScale(symbol: Symbol): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

/**
 * Order in which timeframes are searched when picking the "current" bar for a
 * symbol's quote — prefer M15, then shorter TFs (more recent data), then longer.
 */
const QUOTE_TIMEFRAME_PREFERENCE: readonly Timeframe[] = [
  "M15",
  "M5",
  "M1",
  "M30",
  "H1",
  "H4",
  "D1",
  "W1",
];

export class FixtureBroker implements Broker {
  private readonly clock: ReplayClock;
  private readonly bars: Map<string, readonly Candle[]>;
  private readonly spreadPips: number;
  private readonly pipScale: (symbol: Symbol) => number;
  private readonly accountCurrency: string;
  private readonly pipValuePerLot: number;
  private readonly positions = new Map<string, Position>();
  private nextTicket = 1;
  private balance: number;

  constructor(opts: FixtureBrokerOpts) {
    this.clock = opts.clock;
    this.bars = opts.bars;
    this.spreadPips = opts.spreadPips ?? 0;
    this.pipScale = opts.pipScale ?? defaultPipScale;
    this.accountCurrency = opts.accountCurrency ?? "USD";
    this.pipValuePerLot = opts.pipValuePerLot ?? 10;
    this.balance = opts.startingBalance ?? 10_000;
  }

  async getCandles(
    symbol: Symbol,
    timeframe: Timeframe,
    limit: number,
  ): Promise<readonly Candle[]> {
    const arr = this.bars.get(`${symbol}:${timeframe}`) ?? [];
    const now = this.clock.now();
    const visible = arr.filter((c) => c.ts <= now);
    return visible.slice(-limit);
  }

  async getQuote(symbol: Symbol): Promise<Tick> {
    const bar = this.findLatestBar(symbol);
    if (!bar) throw new BrokerRejectedError(`no bars for ${symbol}`);
    const scale = this.pipScale(symbol);
    const bid = bar.close;
    const ask = bid + this.spreadPips * scale;
    return { ts: this.clock.now(), symbol, bid, ask };
  }

  async getAccount(): Promise<AccountState> {
    return {
      ts: this.clock.now(),
      currency: this.accountCurrency,
      balance: this.balance,
      equity: this.balance,
      freeMargin: this.balance,
      usedMargin: 0,
      marginLevelPct: 0,
    };
  }

  async getOpenPositions(): Promise<readonly Position[]> {
    return [...this.positions.values()];
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (req.type !== "market") {
      throw new BrokerRejectedError("FixtureBroker only supports market orders");
    }
    const bar = this.findLatestBar(req.symbol);
    if (!bar) throw new BrokerRejectedError(`no bars for ${req.symbol}`);
    const scale = this.pipScale(req.symbol);
    const bid = bar.close;
    const ask = bid + this.spreadPips * scale;
    const fillPrice = req.side === "buy" ? ask : bid;
    const ticket = String(this.nextTicket++);
    this.positions.set(ticket, {
      id: ticket,
      symbol: req.symbol,
      side: req.side,
      lotSize: req.lotSize,
      entry: fillPrice,
      sl: req.sl ?? fillPrice,
      tp: req.tp ?? fillPrice,
      openedAt: this.clock.now(),
    });
    return { ticket, fillPrice };
  }

  async modifyOrder(req: ModifyOrderRequest): Promise<void> {
    const p = this.positions.get(req.ticket);
    if (!p) throw new BrokerNotFoundError(`ticket ${req.ticket} not found`);
    this.positions.set(req.ticket, {
      ...p,
      sl: req.sl ?? p.sl,
      tp: req.tp ?? p.tp,
    });
  }

  async closePosition(ticket: string): Promise<ClosePositionResult> {
    const p = this.positions.get(ticket);
    if (!p) throw new BrokerNotFoundError(`ticket ${ticket} not found`);
    const bar = this.findLatestBar(p.symbol);
    if (!bar) throw new BrokerRejectedError(`no bars for ${p.symbol}`);
    const scale = this.pipScale(p.symbol);
    const bid = bar.close;
    const ask = bid + this.spreadPips * scale;
    const closePrice = p.side === "buy" ? bid : ask;
    const direction = p.side === "buy" ? 1 : -1;
    const pips = ((closePrice - p.entry) / scale) * direction;
    const pnl = pips * p.lotSize * this.pipValuePerLot;
    this.balance += pnl;
    this.positions.delete(ticket);
    return { fillPrice: closePrice, pnl, closedAt: this.clock.now() };
  }

  async *streamTicks(symbols: readonly Symbol[]): AsyncIterable<Tick> {
    for (const s of symbols) {
      const bar = this.findLatestBar(s);
      if (!bar) continue;
      const scale = this.pipScale(s);
      const bid = bar.close;
      const ask = bid + this.spreadPips * scale;
      yield { ts: this.clock.now(), symbol: s, bid, ask };
    }
  }

  /**
   * Returns the most recent bar (ts <= clock.now()) for the symbol across the
   * preferred timeframes — M15 first, then progressively shorter/longer TFs.
   */
  private findLatestBar(symbol: Symbol): Candle | undefined {
    const now = this.clock.now();
    for (const tf of QUOTE_TIMEFRAME_PREFERENCE) {
      const arr = this.bars.get(`${symbol}:${tf}`);
      if (!arr || arr.length === 0) continue;
      let latest: Candle | undefined;
      for (const c of arr) {
        if (c.ts > now) break;
        latest = c;
      }
      if (latest) return latest;
    }
    return undefined;
  }
}
