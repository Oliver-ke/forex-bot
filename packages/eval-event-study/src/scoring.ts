import type { RiskDecision, Verdict } from "@forex-bot/contracts";
import type { EventFixture } from "./event-fixture.js";

export interface EventScore {
  fixtureId: string;
  pass: boolean;
  reasons: readonly string[];
}

/**
 * Scores the agent graph's verdict + final risk decision against the realized
 * market move recorded in the fixture.
 *
 * Rules (each contributes a reason; aggregate `pass` is true iff all sub-rules pass):
 * - **Direction match**: realized direction is the sign of `realized.midAtT_plus`
 *   minus the close of the last `bars.M15` bar. `verdict.direction === "long"`
 *   passes when realized > reference; `"short"` passes when realized < reference;
 *   `"neutral"` always passes (we treat it as "abstained" rather than wrong).
 * - **Expected direction match** (only if `fixture.expected?.direction` is set):
 *   `verdict.direction` must equal `expected.direction`. Tolerance is ignored.
 * - **Decision produced**: `decision !== undefined` regardless of approve/veto.
 *   We don't penalise a veto — we just need the graph to have produced one.
 *
 * If `verdict === undefined`, returns `pass = false` with a single reason.
 */
export function scoreDecision(
  fixture: EventFixture,
  verdict: Verdict | undefined,
  decision: RiskDecision | undefined,
): EventScore {
  if (verdict === undefined) {
    return { fixtureId: fixture.id, pass: false, reasons: ["graph produced no verdict"] };
  }

  const lastM15 = fixture.bars.M15.at(-1);
  if (lastM15 === undefined) {
    // MTFBundleSchema requires .min(1) so this branch is defensive only.
    return {
      fixtureId: fixture.id,
      pass: false,
      reasons: ["fixture has no M15 bars to derive reference mid"],
    };
  }
  const referenceMid = lastM15.close;
  const realizedMid = fixture.realized.midAtT_plus;
  const realizedDelta = realizedMid - referenceMid;

  const reasons: string[] = [];
  let pass = true;

  // Rule 1: realized-direction match.
  if (verdict.direction === "neutral") {
    reasons.push(
      `direction: neutral verdict abstains (referenceMid=${referenceMid}, realizedMid=${realizedMid})`,
    );
  } else if (verdict.direction === "long") {
    if (realizedDelta > 0) {
      reasons.push(
        `direction: long verdict matches realized up move (Δ=${realizedDelta.toFixed(5)})`,
      );
    } else {
      pass = false;
      reasons.push(
        `direction: long verdict but realized went down or flat (Δ=${realizedDelta.toFixed(5)})`,
      );
    }
  } else {
    // short
    if (realizedDelta < 0) {
      reasons.push(
        `direction: short verdict matches realized down move (Δ=${realizedDelta.toFixed(5)})`,
      );
    } else {
      pass = false;
      reasons.push(
        `direction: short verdict but realized went up or flat (Δ=${realizedDelta.toFixed(5)})`,
      );
    }
  }

  // Rule 2: expected-direction match (only when fixture pins one).
  const expectedDir = fixture.expected?.direction;
  if (expectedDir !== undefined) {
    if (verdict.direction === expectedDir) {
      reasons.push(`expected: verdict matches expected direction (${expectedDir})`);
    } else {
      pass = false;
      reasons.push(
        `expected: verdict direction "${verdict.direction}" ≠ expected "${expectedDir}"`,
      );
    }
  }

  // Rule 3: a decision was produced (approve or veto both count).
  if (decision === undefined) {
    pass = false;
    reasons.push("decision: no decision was produced (gates blew up?)");
  } else {
    reasons.push(
      decision.approve ? "decision: produced (approved)" : "decision: produced (vetoed)",
    );
  }

  return { fixtureId: fixture.id, pass, reasons };
}
