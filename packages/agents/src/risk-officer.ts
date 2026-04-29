import {
  type RiskDecision,
  RiskDecisionSchema,
  type StateBundle,
  type Verdict,
} from "@forex-bot/contracts";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { RISK_OFFICER_SYSTEM_PROMPT } from "./prompts/risk-officer.js";

export interface RiskOfficerInput {
  tentativeDecision: RiskDecision;
  verdict: Verdict;
  bundle: StateBundle;
  llm: LlmProvider;
}

/**
 * Runs the LLM-side risk officer only when the deterministic gates approved.
 * If the gates already vetoed, the tentative decision is returned unchanged.
 */
export async function riskOfficer(input: RiskOfficerInput): Promise<RiskDecision> {
  if (!input.tentativeDecision.approve) return input.tentativeDecision;
  const userMessage = JSON.stringify(
    {
      symbol: input.bundle.symbol,
      regimePrior: input.bundle.regimePrior,
      verdict: input.verdict,
      tentativeDecision: input.tentativeDecision,
      upcomingHighImpact: input.bundle.upcomingEvents.filter((e) => e.impact === "high"),
      openPositions: input.bundle.openPositions,
    },
    null,
    2,
  );
  const out = await input.llm.structured({
    model: "claude-opus-4-7",
    system: RISK_OFFICER_SYSTEM_PROMPT,
    user: userMessage,
    schema: RiskDecisionSchema,
    effort: "xhigh",
  });
  if (out.approve && input.tentativeDecision.approve) {
    if (out.lotSize > input.tentativeDecision.lotSize) {
      return {
        approve: false,
        vetoReason: `risk-officer attempted to loosen size (${input.tentativeDecision.lotSize} → ${out.lotSize})`,
      };
    }
  }
  return out;
}
