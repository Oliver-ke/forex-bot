import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AccountState, Candle, StateBundle, Symbol, Timeframe } from "@forex-bot/contracts";
import { defaultRiskConfig } from "@forex-bot/contracts";
import { ReplayClock, loadBars, loadCalendar, loadHeadlines } from "@forex-bot/eval-core";
import {
  CachedLlm,
  FixtureBroker,
  FixtureHotCache,
  LlmCache,
  ReplayEngine,
  type ReplayEngineConfig,
  formatJson,
  formatMarkdown,
} from "@forex-bot/eval-replay";
import { AnthropicLlm, type LlmProvider, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";

type Mode = "cheap" | "full";

const ALL_TIMEFRAMES: readonly Timeframe[] = ["M15", "H1", "H4", "D1"];

const USAGE = `Usage: eval-replay [options]

Required:
  --symbols <CSV>            comma-separated symbols, e.g. EURUSD,USDJPY
  --start <ISO>              ISO datetime, e.g. 2024-10-01T00:00Z
  --end <ISO>                ISO datetime, e.g. 2024-12-31T00:00Z
  --bars-dir <path>          directory holding <SYMBOL>-<TF>.csv files
  --headlines <path>         JSON file of NewsHeadline[]
  --calendar <path>          JSON file of CalendarEvent[]
  --out <path>               output directory for report.md/report.json

Optional:
  --mode <cheap|full>        default: cheap (replay-only LLM cache)
  --cache-dir <path>         required when --mode=cheap
  --budget-usd <number>      live LLM budget hint (full mode only)
  --consensus-threshold <n>  default: 0.6
  --starting-equity <n>      default: 10000
  --step-ms <n>              default: 900000 (15 min)
  -h, --help                 print this help and exit
`;

interface ParsedCliArgs {
  symbols: readonly Symbol[];
  startMs: number;
  endMs: number;
  barsDir: string;
  headlines: string;
  calendar: string;
  mode: Mode;
  cacheDir?: string;
  budgetUsd?: number;
  out: string;
  consensusThreshold: number;
  startingEquity: number;
  stepMs: number;
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface RunCliOverrides {
  /**
   * Inject a custom LLM provider, bypassing the default cheap/full wiring.
   * Used in tests to drive the consensus path with a `FakeLlm` rather than
   * exercising the on-disk cache or calling Anthropic.
   */
  overrideLlm?: LlmProvider;
}

export async function runCli(
  argv: readonly string[],
  overrides: RunCliOverrides = {},
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }

  let args: ParsedCliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`error: ${err.message}\n\n${USAGE}`);
      process.exit(1);
    }
    throw err;
  }

  if (args.mode === "cheap" && args.budgetUsd !== undefined) {
    process.stderr.write("warning: --budget-usd is ignored in cheap mode (LLM is replay-only).\n");
  }

  const bars = await loadAllBars(args.barsDir, args.symbols);
  const headlines = await loadHeadlines(args.headlines);
  const calendar = await loadCalendar(args.calendar);

  const clock = new ReplayClock(args.startMs);
  const broker = new FixtureBroker({ clock, bars });
  const cache = new FixtureHotCache({ clock, headlines, calendar });

  const llm = overrides.overrideLlm ?? buildLlm(args);

  const futureBars = (symbol: Symbol, fromMs: number): readonly Candle[] => {
    const arr = bars.get(`${symbol}:H1`) ?? [];
    return arr.filter((b) => b.ts > fromMs);
  };

  const cfg: ReplayEngineConfig = {
    startMs: args.startMs,
    endMs: args.endMs,
    stepMs: args.stepMs,
    symbols: args.symbols,
    consensusThreshold: args.consensusThreshold,
    startingEquity: args.startingEquity,
    ...(llm instanceof CachedLlm ? { llmCacheStats: () => llm.stats } : {}),
  };

  const engine = new ReplayEngine({
    broker,
    cache,
    llm,
    buildGateContext: (bundle, now) => buildGateContext(bundle, now),
    futureBars,
  });

  const report = await engine.run(cfg, clock);

  await mkdir(args.out, { recursive: true });
  const md = formatMarkdown(report);
  const json = formatJson(report);
  await writeFile(join(args.out, "report.md"), md, "utf8");
  await writeFile(join(args.out, "report.json"), json, "utf8");

  const sharpe = formatNum(report.metrics.sharpe);
  const pf = formatNum(report.metrics.profitFactor);
  process.stdout.write(
    `Wrote ${report.trades.length} trades, sharpe=${sharpe}, PF=${pf} -> ${join(
      args.out,
      "report.md",
    )}\n`,
  );
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let parsed: { values: Record<string, string | boolean | undefined> };
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        symbols: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        "bars-dir": { type: "string" },
        headlines: { type: "string" },
        calendar: { type: "string" },
        mode: { type: "string" },
        "cache-dir": { type: "string" },
        out: { type: "string" },
        "budget-usd": { type: "string" },
        "consensus-threshold": { type: "string" },
        "starting-equity": { type: "string" },
        "step-ms": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }) as { values: Record<string, string | boolean | undefined> };
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }

  const v = parsed.values;
  const symbolsRaw = requireString(v.symbols, "--symbols");
  const symbols = symbolsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as Symbol[];
  if (symbols.length === 0) throw new CliUsageError("--symbols cannot be empty");
  for (const s of symbols) {
    if (!/^[A-Z]{6}$/.test(s)) {
      throw new CliUsageError(`invalid symbol: ${s}`);
    }
  }

  const startStr = requireString(v.start, "--start");
  const endStr = requireString(v.end, "--end");
  const startMs = Date.parse(startStr);
  const endMs = Date.parse(endStr);
  if (!Number.isFinite(startMs)) throw new CliUsageError(`invalid --start: ${startStr}`);
  if (!Number.isFinite(endMs)) throw new CliUsageError(`invalid --end: ${endStr}`);
  if (endMs < startMs) throw new CliUsageError("--end must be >= --start");

  const modeStr = (v.mode as string | undefined) ?? "cheap";
  if (modeStr !== "cheap" && modeStr !== "full") {
    throw new CliUsageError(`invalid --mode: ${modeStr} (expected cheap|full)`);
  }
  const mode = modeStr as Mode;

  const cacheDir = v["cache-dir"] as string | undefined;
  if (mode === "cheap" && (cacheDir === undefined || cacheDir.length === 0)) {
    throw new CliUsageError("--cache-dir is required when --mode=cheap");
  }

  const budgetUsd = parseOptionalNumber(v["budget-usd"], "--budget-usd");
  const consensusThreshold =
    parseOptionalNumber(v["consensus-threshold"], "--consensus-threshold") ?? 0.6;
  const startingEquity = parseOptionalNumber(v["starting-equity"], "--starting-equity") ?? 10_000;
  const stepMs = parseOptionalNumber(v["step-ms"], "--step-ms") ?? 15 * 60_000;

  const args: ParsedCliArgs = {
    symbols,
    startMs,
    endMs,
    barsDir: requireString(v["bars-dir"], "--bars-dir"),
    headlines: requireString(v.headlines, "--headlines"),
    calendar: requireString(v.calendar, "--calendar"),
    mode,
    out: requireString(v.out, "--out"),
    consensusThreshold,
    startingEquity,
    stepMs,
  };
  if (cacheDir !== undefined) args.cacheDir = cacheDir;
  if (budgetUsd !== undefined) args.budgetUsd = budgetUsd;
  return args;
}

function requireString(val: unknown, flag: string): string {
  if (typeof val !== "string" || val.length === 0) {
    throw new CliUsageError(`missing required flag ${flag}`);
  }
  return val;
}

function parseOptionalNumber(val: unknown, flag: string): number | undefined {
  if (val === undefined) return undefined;
  if (typeof val !== "string") throw new CliUsageError(`invalid ${flag}`);
  const n = Number(val);
  if (!Number.isFinite(n)) throw new CliUsageError(`invalid ${flag}: ${val}`);
  return n;
}

async function loadAllBars(
  barsDir: string,
  symbols: readonly Symbol[],
): Promise<Map<string, readonly Candle[]>> {
  const out = new Map<string, readonly Candle[]>();
  for (const symbol of symbols) {
    for (const tf of ALL_TIMEFRAMES) {
      const path = join(barsDir, `${symbol}-${tf}.csv`);
      const bars = await loadBars(path, symbol);
      out.set(`${symbol}:${tf}`, bars);
    }
  }
  return out;
}

function buildLlm(args: ParsedCliArgs): LlmProvider {
  if (args.mode === "cheap") {
    if (args.cacheDir === undefined) {
      throw new CliUsageError("--cache-dir is required when --mode=cheap");
    }
    const cache = new LlmCache(args.cacheDir);
    const upstream: LlmProvider = {
      structured<T>(_req: StructuredRequest<T>): Promise<T> {
        return Promise.reject(
          new Error("cheap-mode replay-only: upstream LLM should never be called (cache miss)."),
        );
      },
    };
    return new CachedLlm({ upstream, cache, mode: "replay-only" });
  }
  return buildAnthropicLlm();
}

function buildAnthropicLlm(): LlmProvider {
  // The CI grep blocks `new AnthropicLlm` in *.test.ts files. We honour the
  // intent by instantiating only inside this function — never at module
  // top-level — so test imports of `runCli` never construct a real client.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CliUsageError("ANTHROPIC_API_KEY is required in --mode=full");
  }
  return new AnthropicLlm({ apiKey });
}

function buildGateContext(_bundle: StateBundle, now: number): GateContext {
  const account: AccountState = {
    ts: now,
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    freeMargin: 9_500,
    usedMargin: 500,
    marginLevelPct: 2000,
  };
  return {
    now,
    order: {
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.05,
      entry: 1.08,
      sl: 1.075,
      tp: 1.0875,
      expiresAt: now + 5 * 60_000,
    },
    account,
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: 30,
    session: "london",
    upcomingEvents: [],
    correlation: new CorrelationMatrix({}),
    killSwitch: new KillSwitch(),
    consecutiveLosses: 0,
    dailyPnlPct: 0,
    totalDdPct: 0,
    feedAgeSec: 1,
    currencyExposurePct: {},
    affectedCurrencies: (s) => [s.slice(0, 3), s.slice(3)],
    pipValuePerLot: () => 10,
  };
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  return v.toFixed(2);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");
if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
