import type { AnalystOutput } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregator.js";

function a(
  source: AnalystOutput["source"],
  bias: AnalystOutput["bias"],
  conv: number,
): AnalystOutput {
  return { source, bias, conviction: conv, reasoning: "x", evidence: [] };
}

describe("aggregate", () => {
  it("declares consensus when all 3 agree above threshold", () => {
    const r = aggregate(
      [a("technical", "long", 0.8), a("fundamental", "long", 0.75), a("sentiment", "long", 0.7)],
      { consensusThreshold: 0.7 },
    );
    expect(r.consensus).toBe(true);
    expect(r.direction).toBe("long");
  });

  it("declares no consensus when one analyst dissents", () => {
    const r = aggregate(
      [a("technical", "long", 0.8), a("fundamental", "long", 0.75), a("sentiment", "short", 0.7)],
      { consensusThreshold: 0.7 },
    );
    expect(r.consensus).toBe(false);
  });

  it("declares no consensus when avg conviction < threshold even if directions agree", () => {
    const r = aggregate(
      [a("technical", "long", 0.4), a("fundamental", "long", 0.5), a("sentiment", "long", 0.5)],
      { consensusThreshold: 0.7 },
    );
    expect(r.consensus).toBe(false);
  });

  it("normalizes to a signed signal vector", () => {
    const r = aggregate(
      [a("technical", "long", 0.8), a("fundamental", "long", 0.6), a("sentiment", "neutral", 0.3)],
      { consensusThreshold: 0.7 },
    );
    expect(r.signal.technical).toBeCloseTo(0.8, 5);
    expect(r.signal.sentiment).toBeCloseTo(0, 5);
  });
});
