import { describe, expect, it } from "vitest";
import { killSwitchGate } from "../src/gates/kill-switch.js";
import { KillSwitch } from "../src/kill-switch.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("killSwitchGate", () => {
  it("passes when switch not tripped", () => {
    const ks = new KillSwitch();
    const r = killSwitchGate(mkGateCtx({ killSwitch: ks }));
    expect(r.pass).toBe(true);
  });

  it("blocks when switch is tripped", () => {
    const ks = new KillSwitch();
    ks.tripManual("test");
    const r = killSwitchGate(mkGateCtx({ killSwitch: ks }));
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("kill-switch");
  });

  it("falls back to 'unknown' when tripped without reason", () => {
    const ks = new KillSwitch({ tripped: true });
    const r = killSwitchGate(mkGateCtx({ killSwitch: ks }));
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("unknown");
  });
});
