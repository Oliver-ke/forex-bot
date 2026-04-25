import type { Gate } from "./types.js";

export const currencyExposureGate: Gate = (ctx) => {
  const cap = ctx.config.account.maxExposurePerCurrencyPct;
  const add = ctx.config.perTrade.riskPct;
  const affected = ctx.affectedCurrencies(ctx.order.symbol);
  for (const ccy of affected) {
    const current = ctx.currencyExposurePct[ccy] ?? 0;
    if (current + add > cap) {
      return {
        pass: false,
        gate: "currency-exposure",
        reason: `${ccy} exposure ${(current + add).toFixed(2)}% > cap ${cap}%`,
      };
    }
  }
  return { pass: true, gate: "currency-exposure" };
};
