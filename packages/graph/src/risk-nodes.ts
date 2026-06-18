import { riskOfficer } from "@forex-bot/agents";
import { atr } from "@forex-bot/indicators";
import type { LlmProvider } from "@forex-bot/llm-provider";
import { evaluate } from "@forex-bot/risk";
import type { GraphState } from "./state.js";

/** SL distance = this × ATR(14) from entry; TP at the configured minRR. */
const STOP_ATR_MULTIPLE = 1.5;

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

export async function gatesNode(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.verdict) throw new Error("gatesNode requires state.verdict");
  if (state.verdict.direction === "neutral") {
    return {
      tentativeDecision: { approve: false, vetoReason: "verdict: neutral direction" },
    };
  }
  const side: "buy" | "sell" = state.verdict.direction === "long" ? "buy" : "sell";

  // Build the order from live market data + the verdict direction. The prior
  // stub hardcoded entry/sl/tp (entry 1.08, sl 1.075) — nonsense at JPY price
  // scale (a 0.5-pip stop) and a non-tradeable basis for sizing. Entry is the
  // latest H1 close; SL is STOP_ATR_MULTIPLE × ATR(14) in the trade direction;
  // TP sits at the configured minimum reward:risk.
  const h1 = state.bundle.market.H1;
  const last = h1.at(-1);
  const atrVal = atr(h1, 14).at(-1);
  if (!last || atrVal === undefined || atrVal <= 0) {
    return {
      tentativeDecision: {
        approve: false,
        vetoReason: "sizing: insufficient H1 data for ATR-based stop",
      },
    };
  }
  const entry = last.close;
  const stopDist = STOP_ATR_MULTIPLE * atrVal;
  const rr = state.gateContext.config.perTrade.minRR;
  const sl = side === "buy" ? entry - stopDist : entry + stopDist;
  const tp = side === "buy" ? entry + stopDist * rr : entry - stopDist * rr;

  const ctx = {
    ...state.gateContext,
    atrPips: atrVal / pipScale(state.gateContext.order.symbol),
    order: { ...state.gateContext.order, side, entry, sl, tp },
  };
  return { tentativeDecision: evaluate(ctx) };
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
