import {
  type Broker,
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerTransportError,
  type ClosePositionResult,
  type ModifyOrderRequest,
  type PlaceOrderRequest,
  type PlaceOrderResult,
} from "@forex-bot/broker-core";
import type { AccountState, Candle, Position, Symbol, Tick, Timeframe } from "@forex-bot/contracts";
import { status as GrpcStatus, type ServiceError } from "@grpc/grpc-js";
import {
  type CandlesResponse,
  type MT5Client,
  type OpenPositionsResponse,
  type PlaceOrderResponse,
  type AccountState as ProtoAccountState,
  OrderType as ProtoOrderType,
  type Side as ProtoSide,
  type Tick as ProtoTick,
} from "./generated/mt5.js";
import { sideFromProto, sideToProto, tfToProto } from "./mappings.js";

function lift(err: ServiceError): Error {
  switch (err.code) {
    case GrpcStatus.NOT_FOUND:
      return new BrokerNotFoundError(err.details ?? err.message);
    case GrpcStatus.FAILED_PRECONDITION:
    case GrpcStatus.UNIMPLEMENTED:
      return new BrokerRejectedError(err.details ?? err.message);
    default:
      return new BrokerTransportError(err.details ?? err.message);
  }
}

type UnaryCall<Req, Res> = (req: Req, cb: (err: ServiceError | null, res: Res) => void) => unknown;

function unary<Req, Res>(fn: UnaryCall<Req, Res>): (req: Req) => Promise<Res> {
  return (req) =>
    new Promise<Res>((resolve, reject) => {
      fn(req, (err, res) => {
        if (err) reject(lift(err));
        else resolve(res);
      });
    });
}

export class MT5Broker implements Broker {
  constructor(private readonly client: MT5Client) {}

  async getQuote(symbol: Symbol): Promise<Tick> {
    const t: ProtoTick = await unary<{ symbol: string }, ProtoTick>((req, cb) =>
      this.client.getQuote(req, cb),
    )({ symbol });
    return { ts: Number(t.ts), symbol: t.symbol as Symbol, bid: t.bid, ask: t.ask };
  }

  async getCandles(
    symbol: Symbol,
    timeframe: Timeframe,
    limit: number,
  ): Promise<readonly Candle[]> {
    const r: CandlesResponse = await unary<
      { symbol: string; timeframe: number; limit: number },
      CandlesResponse
    >((req, cb) => this.client.getCandles(req, cb))({
      symbol,
      timeframe: tfToProto(timeframe),
      limit,
    });
    return r.candles.map((c) => ({
      ts: Number(c.ts),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  }

  async getAccount(): Promise<AccountState> {
    const a: ProtoAccountState = await unary<Record<string, never>, ProtoAccountState>((req, cb) =>
      this.client.getAccount(req, cb),
    )({});
    return {
      ts: Number(a.ts),
      currency: a.currency,
      balance: a.balance,
      equity: a.equity,
      freeMargin: a.freeMargin,
      usedMargin: a.usedMargin,
      marginLevelPct: a.marginLevelPct,
    };
  }

  async getOpenPositions(): Promise<readonly Position[]> {
    const r: OpenPositionsResponse = await unary<Record<string, never>, OpenPositionsResponse>(
      (req, cb) => this.client.getOpenPositions(req, cb),
    )({});
    return r.positions.map((p) => ({
      id: p.id,
      symbol: p.symbol as Symbol,
      side: sideFromProto(p.side as ProtoSide),
      lotSize: p.lotSize,
      entry: p.entry,
      sl: p.sl,
      tp: p.tp,
      openedAt: Number(p.openedAt),
    }));
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (req.type !== "market") {
      throw new BrokerRejectedError("MT5Broker only supports market orders in v1");
    }
    const r: PlaceOrderResponse = await unary<unknown, PlaceOrderResponse>((rq, cb) =>
      this.client.placeOrder(rq as never, cb),
    )({
      symbol: req.symbol,
      side: sideToProto(req.side),
      lotSize: req.lotSize,
      type: ProtoOrderType.ORDER_TYPE_MARKET,
      ...(req.entry !== undefined ? { entry: req.entry } : {}),
      ...(req.sl !== undefined ? { sl: req.sl } : {}),
      ...(req.tp !== undefined ? { tp: req.tp } : {}),
      ...(req.expiresAt !== undefined ? { expiresAt: req.expiresAt } : {}),
      ...(req.clientId !== undefined ? { clientId: req.clientId } : {}),
      ...(req.comment !== undefined ? { comment: req.comment } : {}),
    });
    return {
      ticket: r.ticket,
      ...(r.fillPrice !== undefined ? { fillPrice: r.fillPrice } : {}),
      ...(r.pendingOrderId !== undefined ? { pendingOrderId: r.pendingOrderId } : {}),
    };
  }

  async modifyOrder(req: ModifyOrderRequest): Promise<void> {
    await unary<unknown, unknown>((rq, cb) => this.client.modifyOrder(rq as never, cb))({
      ticket: req.ticket,
      ...(req.sl !== undefined ? { sl: req.sl } : {}),
      ...(req.tp !== undefined ? { tp: req.tp } : {}),
    });
  }

  async closePosition(ticket: string): Promise<ClosePositionResult> {
    const r = await unary<{ ticket: string }, { fillPrice: number; pnl: number; closedAt: number }>(
      (rq, cb) => this.client.closePosition(rq, cb),
    )({ ticket });
    return { fillPrice: r.fillPrice, pnl: r.pnl, closedAt: Number(r.closedAt) };
  }

  async *streamTicks(symbols: readonly Symbol[]): AsyncIterable<Tick> {
    const stream = this.client.streamTicks({ symbols: [...symbols] });
    for await (const t of stream as AsyncIterable<ProtoTick>) {
      yield { ts: Number(t.ts), symbol: t.symbol as Symbol, bid: t.bid, ask: t.ask };
    }
  }
}
