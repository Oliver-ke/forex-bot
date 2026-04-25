import { z } from "zod";

export const SymbolSchema = z
  .string()
  .regex(/^[A-Z]{6}$/, "Symbol must be 6 uppercase letters (e.g. EURUSD, XAUUSD)");
export type Symbol = z.infer<typeof SymbolSchema>;

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 three-letter code");
export type Currency = z.infer<typeof CurrencySchema>;

export const PriceSchema = z.number().finite().positive();
export type Price = z.infer<typeof PriceSchema>;

export const PipsSchema = z.number().finite().nonnegative();
export type Pips = z.infer<typeof PipsSchema>;

export const LotSizeSchema = z
  .number()
  .finite()
  .min(0.01)
  .max(100)
  .refine((n) => Math.round(n * 100) === n * 100, "LotSize must be in 0.01 increments");
export type LotSize = z.infer<typeof LotSizeSchema>;

export const SideSchema = z.enum(["buy", "sell"]);
export type Side = z.infer<typeof SideSchema>;

export const TimeframeSchema = z.enum(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]);
export type Timeframe = z.infer<typeof TimeframeSchema>;
