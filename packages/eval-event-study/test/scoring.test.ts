import type { Candle, RiskDecision, Verdict } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import type { EventFixture } from "../src/event-fixture.js";
import { scoreDecision } from "../src/scoring.js";

function bar(ts: number, close: number): Candle {
  return { ts, open: close, high: close + 0.0005, low: close - 0.0005, close, volume: 1 };
}

function buildFixture(overrides: Partial<EventFixture> = {}): EventFixture {
  const base: EventFixture = {
    id: "test-fixture",
    name: "test fixture",
    symbol: "EURUSD",
    decisionAt: 1_700_000_000_000,
    scoringHorizonMin: 30,
    bars: {
      symbol: "EURUSD",
      // last close = 1.0800
      M15: [bar(1, 1.0795), bar(2, 1.0798), bar(3, 1.08)],
      H1: [bar(1, 1.08)],
      H4: [bar(1, 1.08)],
      D1: [bar(1, 1.08)],
    },
    recentNews: [],
    upcomingEvents: [],
    realized: { midAtT_plus: 1.0825, rangePips: 30 },
  };
  return { ...base, ...overrides };
}

const longVerdict: Verdict = {
  direction: "long",
  confidence: 0.7,
  horizon: "H1",
  reasoning: "x",
};
const shortVerdict: Verdict = {
  direction: "short",
  confidence: 0.7,
  horizon: "H1",
  reasoning: "x",
};
const neutralVerdict: Verdict = {
  direction: "neutral",
  confidence: 0.4,
  horizon: "H1",
  reasoning: "x",
};

const approveDecision: RiskDecision = {
  approve: true,
  lotSize: 0.1,
  sl: 1.075,
  tp: 1.0875,
  expiresAt: 1_700_000_300_000,
  reasons: ["all gates pass"],
};

describe("scoreDecision", () => {
  it("realized up + verdict long → pass", () => {
    const fixture = buildFixture(); // realized 1.0825 > reference 1.08
    const res = scoreDecision(fixture, longVerdict, approveDecision);
    expect(res.pass).toBe(true);
    expect(res.reasons.some((r) => /direction: long verdict matches realized up/.test(r))).toBe(
      true,
    );
  });

  it("realized up + verdict short → fail with direction reason", () => {
    const fixture = buildFixture();
    const res = scoreDecision(fixture, shortVerdict, approveDecision);
    expect(res.pass).toBe(false);
    expect(res.reasons.some((r) => /direction: short verdict but realized went up/.test(r))).toBe(
      true,
    );
  });

  it("verdict neutral, expected.direction = long → fails on expected rule but neutral abstains on direction", () => {
    const fixture = buildFixture({ expected: { direction: "long" } });
    const res = scoreDecision(fixture, neutralVerdict, approveDecision);
    expect(res.pass).toBe(false);
    expect(res.reasons.some((r) => /direction: neutral verdict abstains/.test(r))).toBe(true);
    expect(res.reasons.some((r) => /expected.*≠ expected "long"/.test(r))).toBe(true);
  });

  it("expected.direction match: verdict short, expected short, realized down → pass", () => {
    const fixture = buildFixture({
      // realized below reference (1.08) → short direction matches.
      realized: { midAtT_plus: 1.0775, rangePips: 30 },
      expected: { direction: "short" },
    });
    const res = scoreDecision(fixture, shortVerdict, approveDecision);
    expect(res.pass).toBe(true);
    expect(
      res.reasons.some((r) => /expected: verdict matches expected direction \(short\)/.test(r)),
    ).toBe(true);
  });

  it("decision undefined → fail with reason about no decision", () => {
    const fixture = buildFixture();
    const res = scoreDecision(fixture, longVerdict, undefined);
    expect(res.pass).toBe(false);
    expect(res.reasons.some((r) => /decision: no decision was produced/.test(r))).toBe(true);
  });

  it("verdict undefined → single reason, fail", () => {
    const fixture = buildFixture();
    const res = scoreDecision(fixture, undefined, approveDecision);
    expect(res.pass).toBe(false);
    expect(res.reasons).toEqual(["graph produced no verdict"]);
  });

  it("vetoed decision still counts as decision-produced", () => {
    const fixture = buildFixture();
    const veto: RiskDecision = { approve: false, vetoReason: "spread too wide" };
    const res = scoreDecision(fixture, longVerdict, veto);
    expect(res.pass).toBe(true);
    expect(res.reasons.some((r) => /decision: produced \(vetoed\)/.test(r))).toBe(true);
  });
});
