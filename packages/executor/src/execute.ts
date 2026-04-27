import type { Broker, PlaceOrderRequest } from "@forex-bot/broker-core";
import type { PendingOrder, RiskDecision } from "@forex-bot/contracts";
import { preFire } from "./pre-fire.js";
import { initial, transition } from "./state-machine.js";
import type { ExecuteResult, OrderRecord, PreFireInput } from "./types.js";

export interface ExecuteInput {
  now: number;
  correlationId: string;
  decision: Extract<RiskDecision, { approve: true }>;
  order: PendingOrder;
  preFire: PreFireInput;
}

export async function execute(input: ExecuteInput, broker: Broker): Promise<ExecuteResult> {
  let r: OrderRecord = initial(input.correlationId, input.now);

  if (input.decision.expiresAt > 0 && input.now > input.decision.expiresAt) {
    r = transition(r, { kind: "validate" }, input.now);
    r = transition(r, { kind: "expire" }, input.now);
    return { record: r, approved: false };
  }

  r = transition(r, { kind: "validate" }, input.now);
  const pre = preFire(input.preFire);
  if (!pre.pass) {
    r = transition(
      r,
      { kind: "pre_fire_fail", reason: pre.reason ?? "pre-fire failed" },
      input.now,
    );
    return { record: r, approved: false };
  }
  r = transition(r, { kind: "pre_fire_pass" }, input.now);

  r = transition(r, { kind: "submit" }, input.now);
  const req: PlaceOrderRequest = {
    symbol: input.order.symbol,
    side: input.order.side,
    lotSize: input.decision.lotSize,
    type: "market",
    sl: input.decision.sl,
    tp: input.decision.tp,
    expiresAt: input.decision.expiresAt,
    clientId: input.correlationId,
  };
  try {
    const ack = await broker.placeOrder(req);
    r = transition(
      r,
      {
        kind: "submit_ack",
        ticket: ack.ticket,
        ...(ack.fillPrice !== undefined ? { fillPrice: ack.fillPrice } : {}),
      },
      input.now,
    );
    return { record: r, approved: r.state === "submitted" || r.state === "filled" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r = transition(r, { kind: "submit_reject", reason: msg }, input.now);
    return { record: r, approved: false };
  }
}
