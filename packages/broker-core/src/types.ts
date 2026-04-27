import type { Pips, Price, Side, Symbol, Timeframe } from "@forex-bot/contracts";

export type OrderRequestType = "market" | "limit" | "stop";

export interface PlaceOrderRequest {
  symbol: Symbol;
  side: Side;
  lotSize: number;
  type: OrderRequestType;
  entry?: Price;
  sl?: Price;
  tp?: Price;
  expiresAt?: number;
  clientId?: string;
  comment?: string;
}

export interface PlaceOrderResult {
  ticket: string;
  fillPrice?: Price;
  pendingOrderId?: string;
}

export interface ModifyOrderRequest {
  ticket: string;
  sl?: Price;
  tp?: Price;
}

export interface ClosePositionResult {
  fillPrice: Price;
  pnl: number;
  closedAt: number;
}

export class BrokerRejectedError extends Error {
  readonly code = "rejected" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerRejectedError";
  }
}

export class BrokerNotFoundError extends Error {
  readonly code = "not_found" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerNotFoundError";
  }
}

export class BrokerTransportError extends Error {
  readonly code = "transport" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerTransportError";
  }
}

export type { Pips, Price, Side, Symbol, Timeframe };
