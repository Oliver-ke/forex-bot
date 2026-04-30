import { riskOfficer } from "@forex-bot/agents";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { evaluate } from "@forex-bot/risk";
import type { GraphState } from "./state.js";

export async function gatesNode(state: GraphState): Promise<Partial<GraphState>> {
  const decision = evaluate(state.gateContext);
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
