import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type EventFixture,
  type EventRunResult,
  type EventScore,
  LIBRARY_DIR,
  loadEventFixture,
  runEvent,
  scoreDecision,
} from "@forex-bot/eval-event-study";
import {
  AnthropicLlm,
  FakeLlm,
  type LlmProvider,
  type StructuredRequest,
} from "@forex-bot/llm-provider";

type Mode = "cheap" | "full";

const USAGE = `Usage: eval-event-study [options]

Required (one of):
  --id <fixtureId>           run a single fixture by id
  --all                      run every fixture in the canonical library

Optional:
  --mode <cheap|full>        default: cheap
  --cache-dir <path>         (full mode, optional in v1) prepopulated LlmCache dir
  --out <path>               write summary.md and summary.json into this dir
  -h, --help                 print this help and exit

Environment:
  CHEAP_FAKE_LLM=1           in cheap mode, use a built-in fake LLM that
                             routes by system prompt to a long-consensus
                             response. v1 simplification — real cheap mode
                             would prime an LlmCache.
`;

interface ParsedCliArgs {
  id?: string;
  all: boolean;
  mode: Mode;
  cacheDir?: string;
  out?: string;
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
  /**
   * Capture stdout writes (defaults to `process.stdout.write`). Tests inject a
   * collector to assert on the rendered table.
   */
  stdout?: (chunk: string) => void;
  /** Capture stderr writes (defaults to `process.stderr.write`). */
  stderr?: (chunk: string) => void;
}

interface ScoredRow {
  fixture: EventFixture;
  result: EventRunResult;
  score: EventScore;
}

/**
 * Runs the CLI with the given argv slice and returns an exit code rather than
 * calling `process.exit`, so tests can assert the code without tearing down
 * the test runner.
 */
export async function runCli(
  argv: readonly string[],
  overrides: RunCliOverrides = {},
): Promise<number> {
  const stdout = overrides.stdout ?? ((c: string) => void process.stdout.write(c));
  const stderr = overrides.stderr ?? ((c: string) => void process.stderr.write(c));

  if (argv.includes("--help") || argv.includes("-h")) {
    stdout(USAGE);
    return 0;
  }

  let args: ParsedCliArgs;
  let llm: LlmProvider;
  let fixtures: readonly EventFixture[];
  try {
    args = parseCliArgs(argv);

    if (args.mode === "cheap" && args.cacheDir !== undefined) {
      stderr(
        "note: --cache-dir is currently a no-op in cheap mode (v1: cheap mode uses an injected LLM or CHEAP_FAKE_LLM=1).\n",
      );
    }

    llm = resolveLlm(args, overrides);
    fixtures = await loadFixtures(args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      stderr(`error: ${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }

  if (fixtures.length === 0) {
    stderr("error: no fixtures matched the requested selection.\n");
    return 2;
  }

  const rows: ScoredRow[] = [];
  for (const fixture of fixtures) {
    const result = await runEvent(fixture, { llm });
    const score = scoreDecision(fixture, result.verdict, result.finalDecision);
    rows.push({ fixture, result, score });
  }

  const lines = renderRows(rows);
  for (const line of lines) stdout(`${line}\n`);

  const passed = rows.filter((r) => r.score.pass).length;
  const total = rows.length;
  const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
  const footer = `passed ${passed}/${total} (${pct}%)`;
  stdout(`${footer}\n`);

  if (args.out !== undefined) {
    await mkdir(args.out, { recursive: true });
    const md = renderMarkdown(rows, footer);
    const json = renderJson(rows, { passed, total, pct });
    await writeFile(join(args.out, "summary.md"), md, "utf8");
    await writeFile(join(args.out, "summary.json"), json, "utf8");
    stdout(`wrote ${join(args.out, "summary.md")} and summary.json\n`);
  }

  return passed === total ? 0 : 1;
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let parsed: { values: Record<string, string | boolean | undefined> };
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        id: { type: "string" },
        all: { type: "boolean" },
        mode: { type: "string" },
        "cache-dir": { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }) as { values: Record<string, string | boolean | undefined> };
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }

  const v = parsed.values;
  const id = typeof v.id === "string" && v.id.length > 0 ? v.id : undefined;
  const all = v.all === true;
  if (!all && id === undefined) {
    throw new CliUsageError("must pass either --id <fixtureId> or --all");
  }
  if (all && id !== undefined) {
    throw new CliUsageError("--id and --all are mutually exclusive");
  }

  const modeStr = (v.mode as string | undefined) ?? "cheap";
  if (modeStr !== "cheap" && modeStr !== "full") {
    throw new CliUsageError(`invalid --mode: ${modeStr} (expected cheap|full)`);
  }
  const mode = modeStr;

  const cacheDir = typeof v["cache-dir"] === "string" ? v["cache-dir"] : undefined;
  const out = typeof v.out === "string" ? v.out : undefined;

  const args: ParsedCliArgs = { all, mode };
  if (id !== undefined) args.id = id;
  if (cacheDir !== undefined) args.cacheDir = cacheDir;
  if (out !== undefined) args.out = out;
  return args;
}

async function loadFixtures(args: ParsedCliArgs): Promise<readonly EventFixture[]> {
  if (args.all) {
    const entries = await readdir(LIBRARY_DIR);
    const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort();
    const out: EventFixture[] = [];
    for (const name of jsonFiles) {
      out.push(await loadEventFixture(join(LIBRARY_DIR, name)));
    }
    return out;
  }
  if (args.id === undefined) throw new Error("unreachable: --id is required when --all is false");
  return [await loadEventFixture(join(LIBRARY_DIR, `${args.id}.json`))];
}

function resolveLlm(args: ParsedCliArgs, overrides: RunCliOverrides): LlmProvider {
  if (overrides.overrideLlm !== undefined) return overrides.overrideLlm;

  if (args.mode === "full") {
    return buildAnthropicLlm();
  }

  // cheap mode: optional CHEAP_FAKE_LLM=1 escape hatch for local development.
  if (process.env.CHEAP_FAKE_LLM === "1") {
    return new FakeLlm({ route: cheapFakeRoute });
  }

  throw new CliUsageError(
    "cheap mode requires either --cache-dir with prepopulated responses (not yet wired in v1), an injected LLM, or CHEAP_FAKE_LLM=1 to use the built-in fake routes.",
  );
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

/**
 * Built-in fake route used when CHEAP_FAKE_LLM=1 is set. Mirrors the consensus
 * route in `packages/eval-event-study/test/runner.test.ts`: every analyst
 * leans long with high conviction so the consensus path fires and Risk Officer
 * approves. v1 simplification — real cheap-mode would replay from an
 * `LlmCache` of recorded responses.
 */
function cheapFakeRoute(req: StructuredRequest<unknown>): unknown {
  const sys = req.system;
  if (sys.includes("Risk Officer")) {
    return {
      approve: true,
      lotSize: 0.05,
      sl: 1.0,
      tp: 1.1,
      expiresAt: 9_999_999_999_999,
      reasons: ["risk-officer: ok (cheap fake)"],
    };
  }
  if (sys.includes("Judge")) {
    return {
      direction: "long",
      confidence: 0.7,
      horizon: "H1",
      reasoning: "fake judge",
      debated: true,
    };
  }
  if (sys.includes("Bull-side debater")) {
    return { side: "bull", arguments: ["bull"], risks: ["r"], counters: ["c"] };
  }
  if (sys.includes("Bear-side debater")) {
    return { side: "bear", arguments: ["bear"], risks: ["r"], counters: ["c"] };
  }
  if (sys.includes("technical analyst")) {
    return { source: "technical", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
  }
  if (sys.includes("fundamental analyst")) {
    return { source: "fundamental", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
  }
  if (sys.includes("sentiment analyst")) {
    return { source: "sentiment", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
  }
  throw new Error(`cheap fake LLM: unrouted system prompt: ${sys.slice(0, 80)}`);
}

function renderRows(rows: readonly ScoredRow[]): readonly string[] {
  const idWidth = Math.max(0, ...rows.map((r) => r.fixture.id.length));
  const out: string[] = [];
  for (const { fixture, result, score } of rows) {
    const tag = score.pass ? "[PASS]" : "[FAIL]";
    const id = fixture.id.padEnd(idWidth, " ");
    const verdict = result.verdict;
    const verdictStr =
      verdict !== undefined
        ? `${verdict.direction}(${verdict.confidence.toFixed(2)})`
        : "none(-.--)";
    const decision = result.finalDecision;
    const decisionStr = decision === undefined ? "none" : decision.approve ? "approve" : "veto";
    const reasonStr = score.reasons.join("; ");
    out.push(`${tag} ${id}  verdict=${verdictStr}  decision=${decisionStr}  reasons=${reasonStr}`);
  }
  return out;
}

function renderMarkdown(rows: readonly ScoredRow[], footer: string): string {
  const lines: string[] = ["# Event-Study Summary", ""];
  lines.push("| Status | Fixture | Verdict | Decision | Reasons |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const { fixture, result, score } of rows) {
    const status = score.pass ? "PASS" : "FAIL";
    const verdict = result.verdict;
    const verdictStr =
      verdict !== undefined ? `${verdict.direction} (${verdict.confidence.toFixed(2)})` : "—";
    const decision = result.finalDecision;
    const decisionStr = decision === undefined ? "—" : decision.approve ? "approve" : "veto";
    const reasons = score.reasons.join("<br>");
    lines.push(`| ${status} | ${fixture.id} | ${verdictStr} | ${decisionStr} | ${reasons} |`);
  }
  lines.push("");
  lines.push(footer);
  lines.push("");
  return lines.join("\n");
}

function renderJson(
  rows: readonly ScoredRow[],
  agg: { passed: number; total: number; pct: number },
): string {
  const data = {
    aggregate: agg,
    rows: rows.map(({ fixture, result, score }) => ({
      id: fixture.id,
      pass: score.pass,
      verdict: result.verdict ?? null,
      finalDecision: result.finalDecision ?? null,
      tentativeDecision: result.tentativeDecision ?? null,
      reasons: score.reasons,
    })),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");
if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
