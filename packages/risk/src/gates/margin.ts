import type { Gate } from "./types.js";

// Rough notional-based margin estimator. Assumes 1:30 retail leverage.
// notional = lotSize * 100_000 * entry
// required margin = notional / 30
export const marginGate: Gate = (ctx) => {
  const notional = ctx.order.lotSize * 100_000 * ctx.order.entry;
  const required = notional / 30;
  const cap = ctx.account.freeMargin * 0.8;
  if (required > cap) {
    return {
      pass: false,
      gate: "margin",
      reason: `required margin ${required.toFixed(0)} > cap ${cap.toFixed(0)}`,
    };
  }
  return { pass: true, gate: "margin" };
};
