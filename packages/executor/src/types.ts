import type { PendingOrder, Price, RiskDecision } from "@forex-bot/contracts";

export type OrderState =
  | "draft"
  | "pre_fire_failed"
  | "submitting"
  | "submitted"
  | "filled"
  | "rejected"
  | "closed"
  | "expired";

export type OrderEvent =
  | { kind: "validate" }
  | { kind: "pre_fire_pass" }
  | { kind: "pre_fire_fail"; reason: string }
  | { kind: "submit" }
  | { kind: "submit_ack"; ticket: string; fillPrice?: Price }
  | { kind: "submit_reject"; reason: string }
  | { kind: "close"; reason: "manual" | "tp" | "sl" | "expiry" | "kill_switch" }
  | { kind: "expire" };

export interface OrderRecord {
  id: string;
  state: OrderState;
  ticket?: string;
  fillPrice?: Price;
  rejectReason?: string;
  history: ReadonlyArray<{ ts: number; event: OrderEvent }>;
}

export interface ExecuteInput {
  now: number;
  correlationId: string;
  decision: Extract<RiskDecision, { approve: true }>;
  order: PendingOrder;
  preFire: PreFireInput;
}

export interface PreFireInput {
  currentSpreadPips: number;
  medianSpreadPips: number;
  maxSpreadMultiplier: number;
  freeMargin: number;
  estimatedRequiredMargin: number;
  feedAgeSec: number;
  maxFeedAgeSec: number;
}

export interface ExecuteResult {
  record: OrderRecord;
  approved: boolean;
}
