import type { Broker } from "@forex-bot/broker-core";
import type { RiskDecision, StateBundle, Symbol, TickTrigger } from "@forex-bot/contracts";
import type { HotCache } from "@forex-bot/data-core";
import { buildGraph } from "@forex-bot/graph";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GateContext } from "@forex-bot/risk";
import { assembleState } from "./state-assembler.js";

export interface TickInput {
  broker: Broker;
  cache: HotCache;
  llm: LlmProvider;
  symbol: Symbol;
  ts: number;
  trigger: TickTrigger;
  consensusThreshold: number;
  /** Build the GateContext from the assembled bundle (broker quotes, ATR, session, etc.). */
  buildGateContext: (bundle: StateBundle) => GateContext;
}

export interface TickResult {
  bundle: StateBundle;
  decision: RiskDecision;
}

export async function tick(input: TickInput): Promise<TickResult> {
  const bundle = await assembleState({
    broker: input.broker,
    cache: input.cache,
    symbol: input.symbol,
    ts: input.ts,
    trigger: input.trigger,
  });
  const gateContext = input.buildGateContext(bundle);
  const graph = buildGraph({ llm: input.llm, consensusThreshold: input.consensusThreshold });
  const out = await graph.invoke({ bundle, gateContext });
  const decision = out.finalDecision ?? out.tentativeDecision;
  if (!decision) throw new Error("graph produced no decision");
  return { bundle, decision };
}
