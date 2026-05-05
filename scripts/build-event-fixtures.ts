/**
 * Generates the three canonical curated event fixtures used by
 * `@forex-bot/eval-event-study`:
 *   - 2024-Q4 NFP (EURUSD)
 *   - 2024-Q4 FOMC (EURUSD)
 *   - 2015 SNB unpeg (EURCHF)
 *
 * The fixtures are synthetic — they only need to validate against
 * `EventFixtureSchema` (see `library.test.ts`) and tell a plausible
 * narrative for the runner pipeline. They are NOT historically accurate.
 *
 * Usage (Node >= 22 with type-stripping; no tsx required):
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning \
 *     scripts/build-event-fixtures.ts
 *
 * Outputs JSON files to `packages/eval-event-study/src/library/`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "packages", "eval-event-study", "src", "library");

const M15_MS = 15 * 60_000;
const H1_MS = 60 * 60_000;
const H4_MS = 4 * 60 * 60_000;
const D1_MS = 24 * 60 * 60_000;

interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NewsHeadline {
  ts: number;
  source: string;
  title: string;
  summary?: string;
  symbolsMentioned?: string[];
}

interface CalendarEvent {
  ts: number;
  currency: string;
  impact: "low" | "medium" | "high";
  title: string;
  actual?: number;
  forecast?: number;
  previous?: number;
}

interface EventFixture {
  id: string;
  name: string;
  symbol: string;
  decisionAt: number;
  scoringHorizonMin: number;
  bars: { symbol: string; M15: Candle[]; H1: Candle[]; H4: Candle[]; D1: Candle[] };
  recentNews: NewsHeadline[];
  upcomingEvents: CalendarEvent[];
  realized: { midAtT_plus: number; rangePips: number };
  expected?: { direction?: "long" | "short" | "neutral"; tolerance?: number };
}

/** Tiny deterministic PRNG (mulberry32) so output is stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/**
 * Build a random-walk candle series whose first bar starts at
 * `endTs - count*barMs` and whose last bar's `ts` is `endTs - barMs`.
 * Each candle satisfies: high >= max(open,close), low <= min(open,close),
 * positive prices, integer ms ts.
 */
function genBars(opts: {
  count: number;
  endTs: number;
  barMs: number;
  startPrice: number;
  vol: number;
  drift: number;
  seed: number;
  pricePrecision: number;
}): Candle[] {
  const rnd = mulberry32(opts.seed);
  const bars: Candle[] = [];
  let price = opts.startPrice;
  const startTs = opts.endTs - opts.count * opts.barMs;
  for (let i = 0; i < opts.count; i++) {
    const ts = startTs + i * opts.barMs;
    const open = price;
    const r = (rnd() + rnd() + rnd() - 1.5) * 2;
    const close = open + opts.drift + r * opts.vol;
    const span = opts.vol * (0.6 + rnd() * 1.2);
    const hi = Math.max(open, close) + rnd() * span;
    const lo = Math.min(open, close) - rnd() * span;
    const volume = Math.round(500 + rnd() * 2000);
    bars.push({
      ts,
      open: round(open, opts.pricePrecision),
      high: round(hi, opts.pricePrecision),
      low: round(lo, opts.pricePrecision),
      close: round(close, opts.pricePrecision),
      volume,
    });
    price = close;
  }
  return bars;
}

/** EURUSD-style fixture for normal high-impact USD events (NFP / FOMC). */
function makeUsdEventFixture(opts: {
  id: string;
  name: string;
  decisionAt: number;
  scoringHorizonMin: number;
  startPrice: number;
  seed: number;
  recentNews: NewsHeadline[];
  upcomingEvent: CalendarEvent;
  realized: { midAtT_plus: number; rangePips: number };
  expected?: { direction?: "long" | "short" | "neutral"; tolerance?: number };
}): EventFixture {
  const symbol = "EURUSD";
  const precision = 5;
  const m15 = genBars({
    count: 32,
    endTs: opts.decisionAt,
    barMs: M15_MS,
    startPrice: opts.startPrice,
    vol: 0.0006,
    drift: 0,
    seed: opts.seed + 1,
    pricePrecision: precision,
  });
  const h1 = genBars({
    count: 24,
    endTs: opts.decisionAt,
    barMs: H1_MS,
    startPrice: opts.startPrice - 0.002,
    vol: 0.0011,
    drift: 0.00005,
    seed: opts.seed + 2,
    pricePrecision: precision,
  });
  const h4 = genBars({
    count: 12,
    endTs: opts.decisionAt,
    barMs: H4_MS,
    startPrice: opts.startPrice - 0.005,
    vol: 0.002,
    drift: 0.00015,
    seed: opts.seed + 3,
    pricePrecision: precision,
  });
  const d1 = genBars({
    count: 10,
    endTs: opts.decisionAt,
    barMs: D1_MS,
    startPrice: opts.startPrice - 0.012,
    vol: 0.0045,
    drift: 0.0003,
    seed: opts.seed + 4,
    pricePrecision: precision,
  });
  return {
    id: opts.id,
    name: opts.name,
    symbol,
    decisionAt: opts.decisionAt,
    scoringHorizonMin: opts.scoringHorizonMin,
    bars: { symbol, M15: m15, H1: h1, H4: h4, D1: d1 },
    recentNews: opts.recentNews,
    upcomingEvents: [opts.upcomingEvent],
    realized: opts.realized,
    ...(opts.expected ? { expected: opts.expected } : {}),
  };
}

/** Clamp a candle's open/close inside [low, high]. */
function clampOHLC(b: Candle, hiCap: number, loFloor: number): void {
  b.high = Math.min(b.high, hiCap);
  b.low = Math.max(b.low, loFloor);
  if (b.high < b.low) b.high = b.low;
  b.open = Math.min(Math.max(b.open, b.low), b.high);
  b.close = Math.min(Math.max(b.close, b.low), b.high);
}

/**
 * SNB unpeg — EURCHF crashed from ~1.20 to <0.90 intraday on 2015-01-15.
 * Final D1 bar carries the catastrophic intraday range so the
 * `realized.rangePips >= 1500` sanity check has supporting context.
 */
function makeSnbFixture(): EventFixture {
  const symbol = "EURCHF";
  const precision = 5;
  const decisionAt = 1421314200000; // 2015-01-15 09:30 UTC
  const seed = 42;
  const m15 = genBars({
    count: 32,
    endTs: decisionAt,
    barMs: M15_MS,
    startPrice: 1.20105,
    vol: 0.00015,
    drift: 0,
    seed: seed + 1,
    pricePrecision: precision,
  });
  for (const b of m15) clampOHLC(b, 1.2025, 1.19995);
  const h1 = genBars({
    count: 24,
    endTs: decisionAt,
    barMs: H1_MS,
    startPrice: 1.2011,
    vol: 0.0002,
    drift: 0,
    seed: seed + 2,
    pricePrecision: precision,
  });
  for (const b of h1) clampOHLC(b, 1.203, 1.1998);
  const h4 = genBars({
    count: 12,
    endTs: decisionAt,
    barMs: H4_MS,
    startPrice: 1.2012,
    vol: 0.00025,
    drift: 0,
    seed: seed + 3,
    pricePrecision: precision,
  });
  for (const b of h4) clampOHLC(b, 1.2035, 1.1995);
  const d1Pre = genBars({
    count: 9,
    endTs: decisionAt - D1_MS,
    barMs: D1_MS,
    startPrice: 1.2009,
    vol: 0.0004,
    drift: 0,
    seed: seed + 4,
    pricePrecision: precision,
  });
  for (const b of d1Pre) clampOHLC(b, 1.205, 1.1996);
  const unpegBar: Candle = {
    ts: decisionAt,
    open: 1.20105,
    high: 1.20155,
    low: 0.85, // catastrophic low
    close: 0.97,
    volume: 250000,
  };
  const d1 = [...d1Pre, unpegBar];

  const news: NewsHeadline[] = [
    {
      ts: decisionAt - 6 * D1_MS,
      source: "Reuters",
      title: "SNB reaffirms commitment to EUR/CHF 1.20 floor amid ECB QE speculation",
      summary:
        "Vice-Chairman Jean-Pierre Danthine reiterated that the floor remains the cornerstone of monetary policy.",
    },
    {
      ts: decisionAt - 4 * D1_MS,
      source: "Bloomberg",
      title: "Swiss inflation prints negative again as franc pressure mounts",
    },
    {
      ts: decisionAt - 3 * D1_MS,
      source: "FT",
      title: "Speculators stepping up bets on a stronger franc ahead of ECB decision",
    },
    {
      ts: decisionAt - 2 * D1_MS,
      source: "Reuters",
      title: "ECB sources signal large-scale sovereign bond purchases imminent",
    },
    {
      ts: decisionAt - 1 * D1_MS,
      source: "Bloomberg",
      title: "EUR/CHF pinned to 1.2000 floor for fourth straight session",
    },
    {
      ts: decisionAt - 6 * H1_MS,
      source: "DowJones",
      title: "SNB schedules unscheduled press conference for Thursday morning",
    },
    {
      ts: decisionAt - 90 * 60_000,
      source: "Reuters",
      title: "Traders brace as SNB press conference approaches",
    },
  ];
  return {
    id: "2015-snb-unpeg",
    name: "SNB removes EUR/CHF 1.20 floor (Jan 2015)",
    symbol,
    decisionAt,
    scoringHorizonMin: 30,
    bars: { symbol, M15: m15, H1: h1, H4: h4, D1: d1 },
    recentNews: news,
    upcomingEvents: [
      {
        ts: decisionAt,
        currency: "CHF",
        impact: "high",
        title: "SNB Press Conference",
      },
    ],
    realized: {
      midAtT_plus: 0.95,
      // 1.2010 -> 0.85 = ~3500 pips; settle high-low ~2300 pips.
      rangePips: 2300,
    },
    expected: { direction: "short" },
  };
}

function makeNfpFixture(): EventFixture {
  const decisionAt = 1733491800000; // 2024-12-06 13:30 UTC
  const news: NewsHeadline[] = [
    {
      ts: decisionAt - 4 * D1_MS,
      source: "Reuters",
      title: "ADP private payrolls undershoot expectations at 146k vs 150k forecast",
    },
    {
      ts: decisionAt - 3 * D1_MS,
      source: "Bloomberg",
      title: "JOLTS job openings tick higher, hinting at labor market resilience",
    },
    {
      ts: decisionAt - 2 * D1_MS,
      source: "FT",
      title: "Powell signals data-dependent path as December FOMC nears",
    },
    {
      ts: decisionAt - 1 * D1_MS,
      source: "Reuters",
      title: "Weekly jobless claims slip back below 220k",
    },
    {
      ts: decisionAt - 6 * H1_MS,
      source: "DowJones",
      title: "Traders position ahead of NFP; consensus 200k after 12k October print",
    },
    {
      ts: decisionAt - 2 * H1_MS,
      source: "Bloomberg",
      title: "EUR/USD steady near 1.0570 in pre-NFP trading",
    },
  ];
  return makeUsdEventFixture({
    id: "2024-q4-nfp",
    name: "US Non-Farm Payrolls (December 6, 2024)",
    decisionAt,
    scoringHorizonMin: 60,
    startPrice: 1.05705,
    seed: 1234,
    recentNews: news,
    upcomingEvent: {
      ts: decisionAt,
      currency: "USD",
      impact: "high",
      title: "Non-Farm Payrolls",
      forecast: 200000,
      previous: 227000,
      actual: 256000,
    },
    realized: { midAtT_plus: 1.0552, rangePips: 48 },
    expected: { direction: "short", tolerance: 0.0015 },
  });
}

function makeFomcFixture(): EventFixture {
  const decisionAt = 1734548400000; // 2024-12-18 19:00 UTC
  const news: NewsHeadline[] = [
    {
      ts: decisionAt - 6 * D1_MS,
      source: "Reuters",
      title: "US CPI lands in line at 2.7% YoY; core sticky at 3.3%",
    },
    {
      ts: decisionAt - 4 * D1_MS,
      source: "Bloomberg",
      title: "Markets price 96% odds of 25bp cut at December FOMC",
    },
    {
      ts: decisionAt - 3 * D1_MS,
      source: "FT",
      title: "Retail sales beat expectations, complicating dovish narrative",
    },
    {
      ts: decisionAt - 2 * D1_MS,
      source: "DowJones",
      title: "Dot-plot in focus as Fed weighs slower 2025 easing path",
    },
    {
      ts: decisionAt - 1 * D1_MS,
      source: "Reuters",
      title: "Treasury yields back up as traders trim 2025 cut bets",
    },
    {
      ts: decisionAt - 4 * H1_MS,
      source: "Bloomberg",
      title: "EUR/USD churns near 1.0490 ahead of Powell presser",
    },
  ];
  return makeUsdEventFixture({
    id: "2024-q4-fomc",
    name: "FOMC Statement & Press Conference (December 18, 2024)",
    decisionAt,
    scoringHorizonMin: 60,
    startPrice: 1.04925,
    seed: 5678,
    recentNews: news,
    upcomingEvent: {
      ts: decisionAt,
      currency: "USD",
      impact: "high",
      title: "FOMC Statement & Rate Decision",
    },
    realized: { midAtT_plus: 1.0438, rangePips: 56 },
  });
}

function writeFixture(fixture: EventFixture, filename: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, filename);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf-8");
  process.stdout.write(`wrote ${path}\n`);
}

function main(): void {
  writeFixture(makeNfpFixture(), "2024-q4-nfp.json");
  writeFixture(makeFomcFixture(), "2024-q4-fomc.json");
  writeFixture(makeSnbFixture(), "2015-snb-unpeg.json");
}

main();
