import { z } from "zod";
import { SymbolSchema } from "./primitives.js";
import { VerdictSchema, AnalystOutputSchema } from "./analysis.js";
import { RiskDecisionSchema } from "./risk-config.js";

export const TradeOutcomeSchema = z.object({
  closedAt: z.number().int().nonnegative(),
  pnl: z.number(),
  realizedR: z.number(),
  mae: z.number().nonnegative(),
  mfe: z.number().nonnegative(),
  exitReason: z.enum(["tp", "sl", "manual", "expiry", "kill_switch"]),
});
export type TradeOutcome = z.infer<typeof TradeOutcomeSchema>;

export const TradeJournalSchema = z.object({
  tradeId: z.string().min(1),
  symbol: SymbolSchema,
  openedAt: z.number().int().nonnegative(),
  analysts: z.array(AnalystOutputSchema).optional(),
  verdict: VerdictSchema,
  risk: RiskDecisionSchema,
  outcome: TradeOutcomeSchema.optional(),
});
export type TradeJournal = z.infer<typeof TradeJournalSchema>;
