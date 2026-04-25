import { describe, expect, it } from "vitest";
import { RiskConfigSchema, RiskDecisionSchema, defaultRiskConfig } from "../src/risk-config.js";

describe("risk-config", () => {
  it("parses the default config", () => {
    const c = RiskConfigSchema.parse(defaultRiskConfig);
    expect(c.perTrade.riskPct).toBe(1.0);
    expect(c.killSwitch.action).toBe("close_all_and_halt");
  });

  it("rejects riskPct > 5 (sanity cap)", () => {
    expect(() =>
      RiskConfigSchema.parse({
        ...defaultRiskConfig,
        perTrade: { ...defaultRiskConfig.perTrade, riskPct: 6 },
      }),
    ).toThrow();
  });

  it("RiskDecision requires vetoReason when approve=false", () => {
    expect(() => RiskDecisionSchema.parse({ approve: false })).toThrow();
    const d = RiskDecisionSchema.parse({ approve: false, vetoReason: "spread too wide" });
    expect(d.approve).toBe(false);
  });

  it("RiskDecision requires lotSize + SL + TP when approve=true", () => {
    const d = RiskDecisionSchema.parse({
      approve: true,
      lotSize: 0.1,
      sl: 1.07,
      tp: 1.09,
      expiresAt: 2,
      reasons: ["confluence + low spread"],
    });
    expect(d.approve).toBe(true);
    expect(() => RiskDecisionSchema.parse({ approve: true })).toThrow();
  });
});
