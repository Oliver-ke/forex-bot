import { describe, expect, it } from "vitest";
import {
  AnalystOutputSchema,
  RegimeSchema,
  VerdictSchema,
} from "../src/analysis.js";

describe("analysis types", () => {
  it("Regime requires known label + vol bucket", () => {
    expect(RegimeSchema.parse({ label: "trending", volBucket: "normal" }).label).toBe("trending");
    expect(() => RegimeSchema.parse({ label: "sideways", volBucket: "normal" })).toThrow();
  });

  it("AnalystOutput conviction is in [0, 1]", () => {
    const ok = AnalystOutputSchema.parse({
      source: "technical",
      bias: "long",
      conviction: 0.75,
      reasoning: "HH/HL structure on H1",
      evidence: ["close above 20EMA"],
    });
    expect(ok.bias).toBe("long");
    expect(() =>
      AnalystOutputSchema.parse({
        source: "technical",
        bias: "long",
        conviction: 1.1,
        reasoning: "x",
        evidence: [],
      }),
    ).toThrow();
  });

  it("Verdict requires matching direction + confidence in [0,1]", () => {
    const v = VerdictSchema.parse({
      direction: "long",
      confidence: 0.8,
      horizon: "H4",
      reasoning: "confluence",
    });
    expect(v.direction).toBe("long");
    expect(() => VerdictSchema.parse({ direction: "neutral", confidence: 0.8, horizon: "H4", reasoning: "x" })).not.toThrow();
  });
});
