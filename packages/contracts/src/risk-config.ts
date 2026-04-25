import { z } from "zod";
import { LotSizeSchema, PriceSchema, SymbolSchema } from "./primitives.js";

export const RiskProfileSchema = z.enum(["conservative", "standard", "prop_challenge"]);

export const RiskConfigSchema = z.object({
  account: z.object({
    profile: RiskProfileSchema,
    maxDailyLossPct: z.number().positive().max(20),
    maxTotalDrawdownPct: z.number().positive().max(50),
    maxConsecutiveLosses: z.number().int().positive().max(20),
    maxConcurrentPositions: z.number().int().positive().max(20),
    maxExposurePerCurrencyPct: z.number().positive().max(50),
  }),
  perTrade: z.object({
    riskPct: z.number().positive().max(5),
    minRR: z.number().positive().max(10),
    maxLotSize: LotSizeSchema,
  }),
  execution: z.object({
    maxSpreadMultiplier: z.number().positive().max(10),
    minStopDistanceAtr: z.number().positive().max(10),
    slippageTolerancePips: z.number().nonnegative().max(50),
  }),
  newsBlackout: z.object({
    highImpactWindowMin: z.number().int().nonnegative().max(120),
    postReleaseCalmMin: z.number().int().nonnegative().max(60),
  }),
  sessions: z.object({
    asia: z.object({ allowed: z.union([z.array(SymbolSchema), z.literal("all")]) }),
    london: z.object({ allowed: z.union([z.array(SymbolSchema), z.literal("all")]) }),
    ny: z.object({ allowed: z.union([z.array(SymbolSchema), z.literal("all")]) }),
    overlapNyLondon: z.object({ sizeMultiplier: z.number().positive().max(2) }),
  }),
  correlation: z.object({
    matrixRefreshDays: z.number().int().positive().max(90),
    maxNetCorrelatedExposurePct: z.number().positive().max(50),
  }),
  agent: z.object({
    consensusThreshold: z.number().min(0).max(1),
    debateMaxRounds: z.number().int().nonnegative().max(6),
    llmTimeoutMs: z.number().int().positive().max(120_000),
    llmRetryCount: z.number().int().nonnegative().max(5),
  }),
  killSwitch: z.object({
    feedStaleSec: z.number().int().positive().max(600),
    unhandledErrorRatePerHour: z.number().int().positive().max(100),
    action: z.enum(["close_all_and_halt", "halt_new_only"]),
  }),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const defaultRiskConfig: RiskConfig = {
  account: {
    profile: "standard",
    maxDailyLossPct: 3.0,
    maxTotalDrawdownPct: 8.0,
    maxConsecutiveLosses: 4,
    maxConcurrentPositions: 4,
    maxExposurePerCurrencyPct: 6.0,
  },
  perTrade: { riskPct: 1.0, minRR: 1.5, maxLotSize: 2.0 },
  execution: { maxSpreadMultiplier: 2.0, minStopDistanceAtr: 0.5, slippageTolerancePips: 2 },
  newsBlackout: { highImpactWindowMin: 10, postReleaseCalmMin: 5 },
  sessions: {
    asia: { allowed: ["USDJPY", "AUDUSD", "NZDUSD", "XAUUSD"] },
    london: { allowed: "all" },
    ny: { allowed: "all" },
    overlapNyLondon: { sizeMultiplier: 1.2 },
  },
  correlation: { matrixRefreshDays: 7, maxNetCorrelatedExposurePct: 4.0 },
  agent: { consensusThreshold: 0.7, debateMaxRounds: 2, llmTimeoutMs: 30_000, llmRetryCount: 1 },
  killSwitch: { feedStaleSec: 30, unhandledErrorRatePerHour: 5, action: "close_all_and_halt" },
};

export const RiskDecisionSchema = z.discriminatedUnion("approve", [
  z.object({
    approve: z.literal(true),
    lotSize: LotSizeSchema,
    sl: PriceSchema,
    tp: PriceSchema,
    expiresAt: z.number().int().nonnegative(),
    reasons: z.array(z.string()).min(1),
  }),
  z.object({
    approve: z.literal(false),
    vetoReason: z.string().min(1),
  }),
]);
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
