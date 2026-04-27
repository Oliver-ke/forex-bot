import type { OrderEvent, OrderRecord } from "./types.js";

export function initial(id: string, _ts: number): OrderRecord {
  return { id, state: "draft", history: [] };
}

export function transition(prev: OrderRecord, event: OrderEvent, ts: number): OrderRecord {
  const next = nextState(prev, event);
  if (!next) {
    throw new Error(`illegal transition: ${prev.state} on event ${event.kind}`);
  }
  const history = [...prev.history, { ts, event }];
  return { ...prev, ...next, history };
}

function nextState(prev: OrderRecord, event: OrderEvent): Partial<OrderRecord> | null {
  switch (prev.state) {
    case "draft":
      if (event.kind === "validate") return {};
      if (event.kind === "pre_fire_pass") return {};
      if (event.kind === "pre_fire_fail")
        return { state: "pre_fire_failed", rejectReason: event.reason };
      if (event.kind === "submit") return { state: "submitting" };
      if (event.kind === "expire") return { state: "expired" };
      return null;
    case "submitting": {
      if (event.kind === "submit_ack") {
        if (event.fillPrice !== undefined) {
          return { state: "filled", ticket: event.ticket, fillPrice: event.fillPrice };
        }
        return { state: "submitted", ticket: event.ticket };
      }
      if (event.kind === "submit_reject")
        return { state: "rejected", rejectReason: event.reason };
      return null;
    }
    case "submitted":
      if (event.kind === "submit_ack" && event.fillPrice !== undefined)
        return { state: "filled", fillPrice: event.fillPrice };
      if (event.kind === "expire") return { state: "expired" };
      if (event.kind === "close") return { state: "closed" };
      return null;
    case "filled":
      if (event.kind === "close") return { state: "closed" };
      return null;
    case "rejected":
    case "pre_fire_failed":
    case "expired":
    case "closed":
      return null;
  }
}
