import type { Symbol } from "@forex-bot/contracts";
import type { Gate } from "./types.js";

export const sessionGate: Gate = (ctx) => {
  if (ctx.session === "off") return { pass: false, gate: "session", reason: "off-session" };
  const cfg = ctx.config.sessions;
  const spec =
    ctx.session === "asia"
      ? cfg.asia
      : ctx.session === "london"
        ? cfg.london
        : ctx.session === "ny"
          ? cfg.ny
          : { allowed: "all" as const };
  const allowed = spec.allowed;
  if (allowed === "all") return { pass: true, gate: "session" };
  if ((allowed as readonly Symbol[]).includes(ctx.order.symbol)) {
    return { pass: true, gate: "session" };
  }
  return {
    pass: false,
    gate: "session",
    reason: `${ctx.order.symbol} not allowed in ${ctx.session}`,
  };
};
