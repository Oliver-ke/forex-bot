import { aggregate, debate, judge } from "@forex-bot/agents";
import type { Verdict } from "@forex-bot/contracts";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GraphState } from "./state.js";

export interface DebateNodeDeps {
  llm: LlmProvider;
}

export async function bullNode(
  state: GraphState,
  deps: DebateNodeDeps,
): Promise<Partial<GraphState>> {
  if (!state.analysts) throw new Error("bullNode requires state.analysts");
  const out = await debate({
    side: "bull",
    bundle: state.bundle,
    analysts: state.analysts,
    llm: deps.llm,
  });
  return {
    debate: {
      bull: { arguments: out.arguments, risks: out.risks, counters: out.counters },
      bear: state.debate?.bear ?? { arguments: [], risks: [], counters: [] },
    },
  };
}

export async function bearNode(
  state: GraphState,
  deps: DebateNodeDeps,
): Promise<Partial<GraphState>> {
  if (!state.analysts) throw new Error("bearNode requires state.analysts");
  const out = await debate({
    side: "bear",
    bundle: state.bundle,
    analysts: state.analysts,
    llm: deps.llm,
  });
  return {
    debate: {
      bull: state.debate?.bull ?? { arguments: [], risks: [], counters: [] },
      bear: { arguments: out.arguments, risks: out.risks, counters: out.counters },
    },
  };
}

export async function judgeNode(
  state: GraphState,
  deps: DebateNodeDeps,
): Promise<Partial<GraphState>> {
  if (!state.analysts) throw new Error("judgeNode requires state.analysts");
  if (!state.debate) throw new Error("judgeNode requires state.debate");
  const verdict = await judge({
    bundle: state.bundle,
    analysts: state.analysts,
    bull: {
      side: "bull",
      arguments: [...state.debate.bull.arguments],
      risks: [...state.debate.bull.risks],
      counters: [...state.debate.bull.counters],
    },
    bear: {
      side: "bear",
      arguments: [...state.debate.bear.arguments],
      risks: [...state.debate.bear.risks],
      counters: [...state.debate.bear.counters],
    },
    llm: deps.llm,
  });
  return { verdict };
}

export interface ConsensusJudgeDeps {
  consensusThreshold: number;
}

export async function consensusJudgeNode(
  state: GraphState,
  deps: ConsensusJudgeDeps,
): Promise<Partial<GraphState>> {
  if (!state.analysts) throw new Error("consensusJudgeNode requires state.analysts");
  const agg = aggregate(state.analysts, { consensusThreshold: deps.consensusThreshold });
  const horizon = state.bundle.trigger.timeframe ?? "H1";
  const reasoning = state.analysts
    .map((a) => `${a.source}:${a.bias}@${a.conviction.toFixed(2)}`)
    .join("; ");
  const verdict: Verdict = {
    direction: agg.direction,
    confidence: agg.meanConviction,
    horizon,
    reasoning: `consensus — ${reasoning}`,
    debated: false,
  };
  return { verdict };
}
