import type { Gate } from "./types.js";

export const newsBlackoutGate: Gate = (ctx) => {
  const windowMs = ctx.config.newsBlackout.highImpactWindowMin * 60_000;
  const postMs = ctx.config.newsBlackout.postReleaseCalmMin * 60_000;
  const affected = new Set(ctx.affectedCurrencies(ctx.order.symbol));
  for (const e of ctx.upcomingEvents) {
    if (e.impact !== "high") continue;
    if (!affected.has(e.currency)) continue;
    const before = e.ts - windowMs;
    const after = e.ts + postMs;
    if (ctx.now >= before && ctx.now <= after) {
      return {
        pass: false,
        gate: "news-blackout",
        reason: `within blackout of ${e.title} (${e.currency})`,
      };
    }
  }
  return { pass: true, gate: "news-blackout" };
};
