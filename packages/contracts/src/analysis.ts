import { z } from "zod";
import { TimeframeSchema } from "./primitives.js";

export const RegimeLabelSchema = z.enum(["trending", "ranging", "event-driven", "risk-off"]);
export const VolBucketSchema = z.enum(["low", "normal", "high", "extreme"]);

export const RegimeSchema = z.object({
  label: RegimeLabelSchema,
  volBucket: VolBucketSchema,
});
export type Regime = z.infer<typeof RegimeSchema>;

export const BiasSchema = z.enum(["long", "short", "neutral"]);
export type Bias = z.infer<typeof BiasSchema>;

export const AnalystSourceSchema = z.enum(["technical", "fundamental", "sentiment"]);

export const AnalystOutputSchema = z.object({
  source: AnalystSourceSchema,
  bias: BiasSchema,
  conviction: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  evidence: z.array(z.string()),
  data: z.record(z.unknown()).optional(),
});
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

export const VerdictSchema = z.object({
  direction: BiasSchema,
  confidence: z.number().min(0).max(1),
  horizon: TimeframeSchema,
  reasoning: z.string().min(1),
  debated: z.boolean().optional(),
});
export type Verdict = z.infer<typeof VerdictSchema>;
