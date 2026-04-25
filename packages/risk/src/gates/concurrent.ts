import type { Gate } from "./types.js";

export const concurrentPositionsGate: Gate = (ctx) => {
  const cap = ctx.config.account.maxConcurrentPositions;
  if (ctx.openPositions.length >= cap) {
    return {
      pass: false,
      gate: "concurrent-positions",
      reason: `${ctx.openPositions.length} open >= cap ${cap}`,
    };
  }
  return { pass: true, gate: "concurrent-positions" };
};
