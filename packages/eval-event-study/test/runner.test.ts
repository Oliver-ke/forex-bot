import type { Candle, RiskDecision, Verdict } from "@forex-bot/contracts";
import type { GraphState } from "@forex-bot/graph";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import type { EventFixture } from "../src/event-fixture.js";
import { runEvent } from "../src/runner.js";

function bar(ts: number, close: number, opts: { high?: number; low?: number } = {}): Candle {
  const high = opts.high ?? close + 0.0005;
  const low = opts.low ?? close - 0.0005;
  return { ts, open: close, high, low, close, volume: 1 };
}

function buildMinimalFixture(): EventFixture {
  const t0 = 1_700_000_000_000;
  return {
    id: "test-event",
    name: "test event",
    symbol: "EURUSD",
    decisionAt: t0,
    scoringHorizonMin: 30,
    bars: {
      symbol: "EURUSD",
      M15: [bar(t0 - 1800_000, 1.0795), bar(t0 - 900_000, 1.0798), bar(t0, 1.08)],
      H1: [bar(t0 - 3600_000, 1.0795), bar(t0, 1.08)],
      H4: [bar(t0 - 14400_000, 1.079), bar(t0, 1.08)],
      D1: [bar(t0 - 86400_000, 1.078), bar(t0, 1.08)],
    },
    recentNews: [],
    upcomingEvents: [],
    realized: { midAtT_plus: 1.0825, rangePips: 30 },
    expected: { direction: "long" },
  };
}

/**
 * Routes by inspecting the request's system prompt — same pattern used in
 * `packages/graph/test/build-graph.test.ts` and `packages/eval-replay`.
 */
function routeBySystem(req: StructuredRequest<unknown>): unknown {
  const sys = req.system;
  if (sys.includes("Risk Officer")) {
    return {
      approve: true,
      lotSize: 0.05,
      sl: 1.0775,
      tp: 1.085,
      expiresAt: 9_999_999_999_999,
      reasons: ["risk-officer: ok"],
    };
  }
  if (sys.includes("Judge")) {
    return {
      direction: "long",
      confidence: 0.7,
      horizon: "H1",
      reasoning: "judge synthesized long",
      debated: true,
    };
  }
  if (sys.includes("Bull-side debater")) {
    return { side: "bull", arguments: ["bull arg"], risks: ["bull risk"], counters: ["c"] };
  }
  if (sys.includes("Bear-side debater")) {
    return { side: "bear", arguments: ["bear arg"], risks: ["bear risk"], counters: ["c"] };
  }
  if (sys.includes("technical analyst")) {
    return {
      source: "technical",
      bias: "long",
      conviction: 0.85,
      reasoning: "x",
      evidence: [],
    };
  }
  if (sys.includes("fundamental analyst")) {
    return {
      source: "fundamental",
      bias: "long",
      conviction: 0.85,
      reasoning: "x",
      evidence: [],
    };
  }
  if (sys.includes("sentiment analyst")) {
    return {
      source: "sentiment",
      bias: "long",
      conviction: 0.85,
      reasoning: "x",
      evidence: [],
    };
  }
  throw new Error(`unrouted system prompt: ${sys.slice(0, 80)}`);
}

describe("runEvent", () => {
  it("drives the real graph with FakeLlm and produces a verdict + final decision (consensus path)", async () => {
    const fixture = buildMinimalFixture();
    const llm = new FakeLlm({ route: routeBySystem });

    const result = await runEvent(fixture, { llm, consensusThreshold: 0.6 });

    expect(result.fixtureId).toBe("test-event");
    expect(result.verdict).toBeDefined();
    expect(result.verdict?.direction).toBe("long");
    // 3 long analysts above threshold → consensus path → no debate calls.
    const bullCalls = llm.calls.filter((c) => c.system.includes("Bull-side"));
    expect(bullCalls).toHaveLength(0);
    expect(result.tentativeDecision?.approve).toBe(true);
    expect(result.finalDecision?.approve).toBe(true);
    expect(result.graphState.bundle.symbol).toBe("EURUSD");
  });

  it("respects the invokeGraph escape hatch for tests", async () => {
    const fixture = buildMinimalFixture();
    const fakeVerdict: Verdict = {
      direction: "short",
      confidence: 0.55,
      horizon: "H1",
      reasoning: "fake",
    };
    const fakeFinal: RiskDecision = {
      approve: false,
      vetoReason: "fake veto for test",
    };

    let captured: { bundleSymbol?: string; gateNow?: number } = {};
    const result = await runEvent(fixture, {
      llm: new FakeLlm({ route: () => ({}) }), // never called
      invokeGraph: async (input): Promise<GraphState> => {
        captured = { bundleSymbol: input.bundle.symbol, gateNow: input.gateContext.now };
        return {
          bundle: input.bundle,
          gateContext: input.gateContext,
          verdict: fakeVerdict,
          tentativeDecision: { approve: false, vetoReason: "tentative veto" },
          finalDecision: fakeFinal,
        };
      },
    });

    expect(captured.bundleSymbol).toBe("EURUSD");
    expect(captured.gateNow).toBe(fixture.decisionAt);
    expect(result.verdict).toEqual(fakeVerdict);
    expect(result.finalDecision).toEqual(fakeFinal);
  });

  it("uses a custom buildGateContext when provided", async () => {
    const fixture = buildMinimalFixture();
    let gateBuildCount = 0;

    await runEvent(fixture, {
      llm: new FakeLlm({ route: () => ({}) }),
      buildGateContext: (f) => {
        gateBuildCount += 1;
        // minimal stub gate context — invokeGraph short-circuits before it's used.
        return {
          now: f.decisionAt,
          order: {
            symbol: f.symbol,
            side: "buy",
            lotSize: 0.1,
            entry: 1,
            sl: 0.99,
            tp: 1.01,
            expiresAt: f.decisionAt + 60_000,
          },
          // biome-ignore lint/suspicious/noExplicitAny: stub-only (invokeGraph short-circuits gates)
        } as any;
      },
      invokeGraph: async (input) => ({
        bundle: input.bundle,
        gateContext: input.gateContext,
      }),
    });

    expect(gateBuildCount).toBe(1);
  });
});
