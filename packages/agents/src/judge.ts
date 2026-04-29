import { type AnalystOutput, type StateBundle, type Verdict, VerdictSchema } from "@forex-bot/contracts";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { DebaterOutput } from "./debater.js";
import { JUDGE_SYSTEM_PROMPT } from "./prompts/judge.js";

export interface JudgeInput {
  bundle: StateBundle;
  analysts: readonly AnalystOutput[];
  bull: DebaterOutput;
  bear: DebaterOutput;
  llm: LlmProvider;
}

export async function judge(input: JudgeInput): Promise<Verdict> {
  const userMessage = JSON.stringify(
    {
      symbol: input.bundle.symbol,
      regimePrior: input.bundle.regimePrior,
      analysts: input.analysts,
      bull: input.bull,
      bear: input.bear,
    },
    null,
    2,
  );
  const verdict = await input.llm.structured({
    model: "claude-opus-4-7",
    system: JUDGE_SYSTEM_PROMPT,
    user: userMessage,
    schema: VerdictSchema,
    effort: "xhigh",
  });
  return { ...verdict, debated: true };
}
