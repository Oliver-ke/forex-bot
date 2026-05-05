import type { AccountState, Candle, Position, Symbol, Tick, Timeframe } from "@forex-bot/contracts";
import type { Broker } from "./broker.js";
import {
  BrokerNotFoundError,
  BrokerRejectedError,
  type ClosePositionResult,
  type ModifyOrderRequest,
  type PlaceOrderRequest,
  type PlaceOrderResult,
} from "./types.js";

export interface FakeBrokerOptions {
  accountCurrency: string;
  startingBalance: number;
  pipScale: (symbol: Symbol) => number;
  pipValuePerLot?: number;
  nowFn?: () => number;
  /** Defaults to true — FakeBroker is paper unless explicitly overridden. */
  isDemo?: boolean;
}

export class FakeBroker implements Broker {
  readonly isDemo: boolean;
  private readonly opts: Required<Omit<FakeBrokerOptions, "isDemo">>;
  private readonly quotes = new Map<Symbol, { bid: number; ask: number; ts: number }>();
  private readonly candles = new Map<string, Candle[]>();
  private readonly positions = new Map<string, Position>();
  private nextTicket = 1;
  private balance: number;
  private equity: number;

  constructor(opts: FakeBrokerOptions) {
    this.opts = {
      pipValuePerLot: 10,
      nowFn: Date.now,
      ...opts,
    };
    this.isDemo = opts.isDemo ?? true;
    this.balance = opts.startingBalance;
    this.equity = opts.startingBalance;
  }

  setQuote(symbol: Symbol, bid: number, ask: number): void {
    if (ask < bid) throw new Error("setQuote: ask must be >= bid");
    this.quotes.set(symbol, { bid, ask, ts: this.opts.nowFn() });
  }

  setCandles(symbol: Symbol, timeframe: Timeframe, candles: readonly Candle[]): void {
    this.candles.set(`${symbol}:${timeframe}`, [...candles]);
  }

  async getQuote(symbol: Symbol): Promise<Tick> {
    const q = this.quotes.get(symbol);
    if (!q) throw new BrokerRejectedError(`no quote for ${symbol}`);
    return { ts: q.ts, symbol, bid: q.bid, ask: q.ask };
  }

  async getCandles(
    symbol: Symbol,
    timeframe: Timeframe,
    limit: number,
  ): Promise<readonly Candle[]> {
    const arr = this.candles.get(`${symbol}:${timeframe}`) ?? [];
    return arr.slice(-limit);
  }

  async getAccount(): Promise<AccountState> {
    return {
      ts: this.opts.nowFn(),
      currency: this.opts.accountCurrency,
      balance: this.balance,
      equity: this.equity,
      freeMargin: this.equity,
      usedMargin: 0,
      marginLevelPct: 0,
    };
  }

  async getOpenPositions(): Promise<readonly Position[]> {
    return [...this.positions.values()];
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (req.type !== "market") {
      throw new BrokerRejectedError("FakeBroker only supports market orders");
    }
    const q = this.quotes.get(req.symbol);
    if (!q) throw new BrokerRejectedError(`no quote for ${req.symbol}`);
    const fillPrice = req.side === "buy" ? q.ask : q.bid;
    const ticket = String(this.nextTicket++);
    this.positions.set(ticket, {
      id: ticket,
      symbol: req.symbol,
      side: req.side,
      lotSize: req.lotSize,
      entry: fillPrice,
      sl: req.sl ?? fillPrice,
      tp: req.tp ?? fillPrice,
      openedAt: this.opts.nowFn(),
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
    const q = this.quotes.get(p.symbol);
    if (!q) throw new BrokerRejectedError(`no quote for ${p.symbol}`);
    const closePrice = p.side === "buy" ? q.bid : q.ask;
    const scale = this.opts.pipScale(p.symbol);
    const direction = p.side === "buy" ? 1 : -1;
    const pips = ((closePrice - p.entry) / scale) * direction;
    const pnl = pips * p.lotSize * this.opts.pipValuePerLot;
    this.balance += pnl;
    this.equity = this.balance;
    this.positions.delete(ticket);
    return { fillPrice: closePrice, pnl, closedAt: this.opts.nowFn() };
  }

  async *streamTicks(symbols: readonly Symbol[]): AsyncIterable<Tick> {
    for (const s of symbols) {
      const q = this.quotes.get(s);
      if (q) yield { ts: q.ts, symbol: s, bid: q.bid, ask: q.ask };
    }
  }
}
