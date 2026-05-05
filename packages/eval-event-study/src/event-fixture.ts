import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CalendarEventSchema,
  MTFBundleSchema,
  NewsHeadlineSchema,
  SymbolSchema,
} from "@forex-bot/contracts";
import { z } from "zod";

export const EventFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbol: SymbolSchema,
  /** ms epoch when the agent must produce a decision. */
  decisionAt: z.number().int().nonnegative(),
  scoringHorizonMin: z.number().int().positive(),
  bars: MTFBundleSchema,
  recentNews: z.array(NewsHeadlineSchema),
  upcomingEvents: z.array(CalendarEventSchema),
  realized: z.object({
    /** Mid price `scoringHorizonMin` after `decisionAt`. */
    midAtT_plus: z.number(),
    /** Realized intraday range over the horizon. */
    rangePips: z.number(),
  }),
  expected: z
    .object({
      direction: z.enum(["long", "short", "neutral"]).optional(),
      tolerance: z.number().optional(),
    })
    .optional(),
});

export type EventFixture = z.infer<typeof EventFixtureSchema>;

/**
 * Absolute filesystem path to the canonical fixture library shipped with this
 * package. Resolved relative to this module's URL so it works from any cwd
 * (CLI, tests, downstream apps).
 */
export const LIBRARY_DIR = join(dirname(fileURLToPath(import.meta.url)), "library");

/** Loads a JSON fixture from disk and validates against the schema. */
export async function loadEventFixture(path: string): Promise<EventFixture> {
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse event fixture JSON at ${path}: ${(err as Error).message}`);
  }
  const result = EventFixtureSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`event fixture schema validation failed at ${path}: ${result.error.message}`);
  }
  return result.data;
}
