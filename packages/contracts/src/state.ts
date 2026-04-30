import { z } from "zod";
import { AccountStateSchema, PositionSchema } from "./account.js";
import { RegimeSchema } from "./analysis.js";
import { MTFBundleSchema } from "./market.js";
import { SymbolSchema, TimeframeSchema } from "./primitives.js";

export const NewsHeadlineSchema = z.object({
  ts: z.number().int().nonnegative(),
  source: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  symbolsMentioned: z.array(SymbolSchema).optional(),
});
export type NewsHeadline = z.infer<typeof NewsHeadlineSchema>;

export const CalendarEventSchema = z.object({
  ts: z.number().int().nonnegative(),
  currency: z.string().length(3),
  impact: z.enum(["low", "medium", "high"]),
  title: z.string().min(1),
  actual: z.number().optional(),
  forecast: z.number().optional(),
  previous: z.number().optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const TickTriggerSchema = z.object({
  reason: z.enum(["schedule", "price_event", "news_event", "rebalance"]),
  timeframe: TimeframeSchema.optional(),
  detail: z.string().optional(),
});
export type TickTrigger = z.infer<typeof TickTriggerSchema>;

export const StateBundleSchema = z.object({
  symbol: SymbolSchema,
  ts: z.number().int().nonnegative(),
  trigger: TickTriggerSchema,
  market: MTFBundleSchema,
  account: AccountStateSchema,
  openPositions: z.array(PositionSchema),
  recentNews: z.array(NewsHeadlineSchema),
  upcomingEvents: z.array(CalendarEventSchema),
  regimePrior: RegimeSchema,
});
export type StateBundle = z.infer<typeof StateBundleSchema>;
