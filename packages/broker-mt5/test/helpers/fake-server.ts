import * as grpc from "@grpc/grpc-js";
import { type Server, ServerCredentials, status as GrpcStatus } from "@grpc/grpc-js";
import { MT5Service, OrderType, Side } from "../../src/generated/mt5.js";

interface FakePosition {
  id: string;
  symbol: string;
  side: number;
  lotSize: number;
  entry: number;
  sl: number;
  tp: number;
  openedAt: number;
}

export interface FakeState {
  quotes: Map<string, { bid: number; ask: number; ts: number }>;
  positions: Map<string, FakePosition>;
}

export function startFakeServer(): Promise<{ port: number; server: Server; state: FakeState }> {
  const state: FakeState = { quotes: new Map(), positions: new Map() };
  state.quotes.set("EURUSD", { bid: 1.0801, ask: 1.0803, ts: 1 });

  // biome-ignore lint/suspicious/noExplicitAny: gRPC handler shapes are loose by design here
  const impl: any = {
    getQuote: (call: any, cb: any) => {
      const q = state.quotes.get(call.request.symbol);
      if (!q) return cb({ code: GrpcStatus.NOT_FOUND, details: "no quote" });
      cb(null, { ts: q.ts, symbol: call.request.symbol, bid: q.bid, ask: q.ask });
    },
    getCandles: (_call: any, cb: any) => cb(null, { candles: [] }),
    getAccount: (_call: any, cb: any) =>
      cb(null, {
        ts: 1,
        currency: "USD",
        balance: 10_000,
        equity: 10_000,
        freeMargin: 10_000,
        usedMargin: 0,
        marginLevelPct: 0,
      }),
    getOpenPositions: (_call: any, cb: any) =>
      cb(null, { positions: [...state.positions.values()] }),
    placeOrder: (call: any, cb: any) => {
      if (call.request.type !== OrderType.ORDER_TYPE_MARKET) {
        return cb({ code: GrpcStatus.UNIMPLEMENTED, details: "non-market unsupported" });
      }
      const q = state.quotes.get(call.request.symbol);
      if (!q) return cb({ code: GrpcStatus.NOT_FOUND, details: "no quote" });
      const ticket = String(state.positions.size + 1);
      state.positions.set(ticket, {
        id: ticket,
        symbol: call.request.symbol,
        side: call.request.side,
        lotSize: call.request.lotSize,
        entry: call.request.side === Side.SIDE_BUY ? q.ask : q.bid,
        sl: call.request.sl ?? 0,
        tp: call.request.tp ?? 0,
        openedAt: 1,
      });
      cb(null, {
        ticket,
        fillPrice: call.request.side === Side.SIDE_BUY ? q.ask : q.bid,
      });
    },
    modifyOrder: (_call: any, cb: any) =>
      cb({ code: GrpcStatus.UNIMPLEMENTED, details: "not implemented" }),
    closePosition: (call: any, cb: any) => {
      const p = state.positions.get(call.request.ticket);
      if (!p) return cb({ code: GrpcStatus.NOT_FOUND, details: "ticket not found" });
      state.positions.delete(call.request.ticket);
      cb(null, { fillPrice: p.entry, pnl: 0, closedAt: 2 });
    },
    streamTicks: (call: any) => {
      for (const s of (call.request.symbols ?? []) as string[]) {
        const q = state.quotes.get(s);
        if (q) call.write({ ts: q.ts, symbol: s, bid: q.bid, ask: q.ask });
      }
      call.end();
    },
  };

  const server = new grpc.Server();
  server.addService(MT5Service, impl);
  return new Promise((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve({ port, server, state });
    });
  });
}
