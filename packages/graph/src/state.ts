import type { AnalystOutput, RiskDecision, StateBundle, Verdict } from "@forex-bot/contracts";
import type { GateContext } from "@forex-bot/risk";

export interface GraphDebate {
  bull: { arguments: readonly string[]; risks: readonly string[]; counters: readonly string[] };
  bear: { arguments: readonly string[]; risks: readonly string[]; counters: readonly string[] };
}

export interface GraphState {
  bundle: StateBundle;
  /** Filled by Aggregator after parallel analyst fanout. */
  analysts?: readonly AnalystOutput[];
  /** Whether all 3 agreed above threshold. */
  consensus?: boolean;
  /** Optional debate transcript when consensus = false. */
  debate?: GraphDebate;
  verdict?: Verdict;
  /** Output of the 9-gate evaluator from Plan 1 (pre-Risk-Officer). */
  tentativeDecision?: RiskDecision;
  /** Final decision after Risk Officer LLM. */
  finalDecision?: RiskDecision;
  /** Risk gate context the runner constructs from broker + cache. */
  gateContext: GateContext;
}
