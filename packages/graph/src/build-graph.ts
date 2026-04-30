import type { LlmProvider } from "@forex-bot/llm-provider";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { bearNode, bullNode, consensusJudgeNode, judgeNode } from "./debate-nodes.js";
import { aggregatorNode, analystsNode, regimeNode } from "./nodes.js";
import { gatesNode, riskOfficerNode } from "./risk-nodes.js";
import type { GraphState } from "./state.js";

const StateAnnotation = Annotation.Root({
  bundle: Annotation<GraphState["bundle"]>(),
  analysts: Annotation<GraphState["analysts"]>(),
  consensus: Annotation<GraphState["consensus"]>(),
  debate: Annotation<GraphState["debate"]>(),
  verdict: Annotation<GraphState["verdict"]>(),
  tentativeDecision: Annotation<GraphState["tentativeDecision"]>(),
  finalDecision: Annotation<GraphState["finalDecision"]>(),
  gateContext: Annotation<GraphState["gateContext"]>(),
});

export interface BuildGraphDeps {
  llm: LlmProvider;
  consensusThreshold: number;
}

export function buildGraph(deps: BuildGraphDeps) {
  const g = new StateGraph(StateAnnotation)
    .addNode("regime", (s) => regimeNode(s as GraphState, deps))
    .addNode("analystsFanout", (s) => analystsNode(s as GraphState, deps))
    .addNode("aggregator", (s) =>
      aggregatorNode(s as GraphState, { consensusThreshold: deps.consensusThreshold }),
    )
    .addNode("bull", (s) => bullNode(s as GraphState, deps))
    .addNode("bear", (s) => bearNode(s as GraphState, deps))
    .addNode("judge", (s) => judgeNode(s as GraphState, deps))
    .addNode("consensusJudge", (s) =>
      consensusJudgeNode(s as GraphState, { consensusThreshold: deps.consensusThreshold }),
    )
    .addNode("gates", (s) => gatesNode(s as GraphState))
    .addNode("riskOfficer", (s) => riskOfficerNode(s as GraphState, deps))
    .addEdge(START, "regime")
    .addEdge("regime", "analystsFanout")
    .addEdge("analystsFanout", "aggregator")
    .addConditionalEdges("aggregator", (s) => (s.consensus ? "consensusJudge" : "bull"), {
      consensusJudge: "consensusJudge",
      bull: "bull",
    })
    .addEdge("bull", "bear")
    .addEdge("bear", "judge")
    .addEdge("judge", "gates")
    .addEdge("consensusJudge", "gates")
    .addConditionalEdges("gates", (s) => (s.tentativeDecision?.approve ? "riskOfficer" : "end"), {
      riskOfficer: "riskOfficer",
      end: END,
    })
    .addEdge("riskOfficer", END);
  return g.compile();
}
