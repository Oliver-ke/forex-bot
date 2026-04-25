import { z } from "zod";
import { PriceSchema, SymbolSchema } from "./primitives.js";

export const CandleSchema = z
  .object({
    ts: z.number().int().nonnegative(),
    open: PriceSchema,
    high: PriceSchema,
    low: PriceSchema,
    close: PriceSchema,
    volume: z.number().nonnegative(),
  })
  .refine((c) => c.high >= c.low, "high must be >= low")
  .refine((c) => c.open >= c.low && c.open <= c.high, "open must be within [low, high]")
  .refine((c) => c.close >= c.low && c.close <= c.high, "close must be within [low, high]");
export type Candle = z.infer<typeof CandleSchema>;

export const TickSchema = z
  .object({
    ts: z.number().int().nonnegative(),
    symbol: SymbolSchema,
    bid: PriceSchema,
    ask: PriceSchema,
  })
  .refine((t) => t.ask >= t.bid, "ask must be >= bid");
export type Tick = z.infer<typeof TickSchema>;

export const MTFBundleSchema = z.object({
  symbol: SymbolSchema,
  M15: z.array(CandleSchema).min(1),
  H1: z.array(CandleSchema).min(1),
  H4: z.array(CandleSchema).min(1),
  D1: z.array(CandleSchema).min(1),
});
export type MTFBundle = z.infer<typeof MTFBundleSchema>;
