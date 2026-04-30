import {
  aggregate,
  classifyRegime,
  fundamentalAnalyst,
  sentimentAnalyst,
  taAnalyst,
} from "@forex-bot/agents";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GraphState } from "./state.js";

export interface NodeDeps {
  llm: LlmProvider;
}

export async function regimeNode(state: GraphState, _deps: NodeDeps): Promise<Partial<GraphState>> {
  const regime = classifyRegime({
    candlesH1: state.bundle.market.H1,
    upcomingHighImpactCount: state.bundle.upcomingEvents.filter((e) => e.impact === "high").length,
  });
  return { bundle: { ...state.bundle, regimePrior: regime } };
}

export async function analystsNode(
  state: GraphState,
  deps: NodeDeps,
): Promise<Partial<GraphState>> {
  const [ta, fundamental, sentiment] = await Promise.all([
    taAnalyst({ bundle: state.bundle, llm: deps.llm }),
    fundamentalAnalyst({ bundle: state.bundle, llm: deps.llm }),
    sentimentAnalyst({ bundle: state.bundle, llm: deps.llm }),
  ]);
  return { analysts: [ta, fundamental, sentiment] };
}

export interface AggregatorNodeDeps {
  consensusThreshold: number;
}

export async function aggregatorNode(
  state: GraphState,
  deps: AggregatorNodeDeps,
): Promise<Partial<GraphState>> {
  if (!state.analysts) throw new Error("aggregatorNode requires state.analysts");
  const out = aggregate(state.analysts, { consensusThreshold: deps.consensusThreshold });
  return { consensus: out.consensus };
}
