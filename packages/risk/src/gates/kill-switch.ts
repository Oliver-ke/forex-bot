import type { Gate } from "./types.js";

export const killSwitchGate: Gate = (ctx) => {
  const s = ctx.killSwitch.state();
  if (s.tripped) {
    return { pass: false, gate: "kill-switch", reason: `kill-switch tripped: ${s.reason ?? "unknown"}` };
  }
  return { pass: true, gate: "kill-switch" };
};
