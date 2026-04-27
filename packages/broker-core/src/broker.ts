import type { AccountState, Candle, Position, Symbol, Tick, Timeframe } from "@forex-bot/contracts";
import type {
  ClosePositionResult,
  ModifyOrderRequest,
  PlaceOrderRequest,
  PlaceOrderResult,
} from "./types.js";

export interface Broker {
  getQuote(symbol: Symbol): Promise<Tick>;
  getCandles(symbol: Symbol, timeframe: Timeframe, limit: number): Promise<readonly Candle[]>;
  getAccount(): Promise<AccountState>;
  getOpenPositions(): Promise<readonly Position[]>;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  modifyOrder(req: ModifyOrderRequest): Promise<void>;
  closePosition(ticket: string): Promise<ClosePositionResult>;
  streamTicks(symbols: readonly Symbol[]): AsyncIterable<Tick>;
}
