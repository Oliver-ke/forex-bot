import { z } from "zod";
import { CurrencySchema, LotSizeSchema, PriceSchema, SideSchema, SymbolSchema } from "./primitives.js";

export const AccountStateSchema = z.object({
  ts: z.number().int().nonnegative(),
  currency: CurrencySchema,
  balance: z.number().finite().nonnegative(),
  equity: z.number().finite().positive(),
  freeMargin: z.number().finite().nonnegative(),
  usedMargin: z.number().finite().nonnegative(),
  marginLevelPct: z.number().finite().nonnegative(),
});
export type AccountState = z.infer<typeof AccountStateSchema>;

export const PositionSchema = z
  .object({
    id: z.string().min(1),
    symbol: SymbolSchema,
    side: SideSchema,
    lotSize: LotSizeSchema,
    entry: PriceSchema,
    sl: PriceSchema,
    tp: PriceSchema,
    openedAt: z.number().int().nonnegative(),
  })
  .refine(
    (p) => (p.side === "buy" ? p.sl < p.entry && p.tp > p.entry : p.sl > p.entry && p.tp < p.entry),
    "SL/TP must be on correct sides of entry for the chosen side",
  );
export type Position = z.infer<typeof PositionSchema>;

export const PendingOrderSchema = z.object({
  symbol: SymbolSchema,
  side: SideSchema,
  lotSize: LotSizeSchema,
  entry: PriceSchema,
  sl: PriceSchema,
  tp: PriceSchema,
  expiresAt: z.number().int().nonnegative(),
});
export type PendingOrder = z.infer<typeof PendingOrderSchema>;
