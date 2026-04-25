import type { Gate } from "./types.js";

export const spreadGate: Gate = (ctx) => {
  const cap = ctx.medianSpreadPips * ctx.config.execution.maxSpreadMultiplier;
  if (ctx.currentSpreadPips > cap) {
    return {
      pass: false,
      gate: "spread",
      reason: `spread ${ctx.currentSpreadPips.toFixed(2)}p > cap ${cap.toFixed(2)}p`,
    };
  }
  return { pass: true, gate: "spread" };
};
