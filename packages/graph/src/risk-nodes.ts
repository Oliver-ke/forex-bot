import { riskOfficer } from "@forex-bot/agents";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { evaluate } from "@forex-bot/risk";
import type { GraphState } from "./state.js";

export async function gatesNode(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.verdict) throw new Error("gatesNode requires state.verdict");
  if (state.verdict.direction === "neutral") {
    return {
      tentativeDecision: { approve: false, vetoReason: "verdict: neutral direction" },
    };
  }
  const side: "buy" | "sell" = state.verdict.direction === "long" ? "buy" : "sell";
  const ctx = { ...state.gateContext, order: { ...state.gateContext.order, side } };
  const decision = evaluate(ctx);
  return { tentativeDecision: decision };
}

export interface RiskOfficerNodeDeps {
  llm: LlmProvider;
}

export async function riskOfficerNode(
  state: GraphState,
  deps: RiskOfficerNodeDeps,
): Promise<Partial<GraphState>> {
  if (!state.tentativeDecision) {
    throw new Error("riskOfficerNode requires state.tentativeDecision");
  }
  if (!state.verdict) throw new Error("riskOfficerNode requires state.verdict");
  const finalDecision = await riskOfficer({
    tentativeDecision: state.tentativeDecision,
    verdict: state.verdict,
    bundle: state.bundle,
    llm: deps.llm,
  });
  return { finalDecision };
}
