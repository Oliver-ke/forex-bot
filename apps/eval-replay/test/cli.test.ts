import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarEvent, Candle, NewsHeadline } from "@forex-bot/contracts";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const HOUR_MS = 60 * 60_000;
const START_MS = Date.UTC(2024, 0, 1, 0, 0, 0);
const END_MS = START_MS + 9 * HOUR_MS;

function bar(ts: number, close: number, opts: { high?: number; low?: number } = {}): Candle {
  const high = opts.high ?? close + 0.0005;
  const low = opts.low ?? close - 0.0005;
  return { ts, open: close, high, low, close, volume: 1 };
}

function buildBars(): readonly Candle[] {
  return [
    bar(START_MS + 0 * HOUR_MS, 1.08),
    bar(START_MS + 1 * HOUR_MS, 1.0805),
    bar(START_MS + 2 * HOUR_MS, 1.081),
    bar(START_MS + 3 * HOUR_MS, 1.0815),
    bar(START_MS + 4 * HOUR_MS, 1.082),
    bar(START_MS + 5 * HOUR_MS, 1.0815),
    bar(START_MS + 6 * HOUR_MS, 1.081),
    bar(START_MS + 7 * HOUR_MS, 1.078, { low: 1.075, high: 1.0815 }),
    bar(START_MS + 8 * HOUR_MS, 1.0775),
    bar(START_MS + 9 * HOUR_MS, 1.077),
  ];
}

function barsToCsv(bars: readonly Candle[]): string {
  const lines = ["ts,open,high,low,close,volume"];
  for (const b of bars) {
    lines.push(`${b.ts},${b.open},${b.high},${b.low},${b.close},${b.volume}`);
  }
  return lines.join("\n");
}

function consensusLongRoute() {
  return (req: StructuredRequest<unknown>): unknown => {
    const sys = req.system;
    if (sys.includes("Risk Officer")) {
      return {
        approve: true,
        lotSize: 0.05,
        sl: 1.075,
        tp: 1.0875,
        expiresAt: 9_999_999_999_999,
        reasons: ["risk-officer: ok"],
      };
    }
    if (sys.includes("technical analyst"))
      return { source: "technical", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
    if (sys.includes("fundamental analyst"))
      return {
        source: "fundamental",
        bias: "long",
        conviction: 0.85,
        reasoning: "x",
        evidence: [],
      };
    if (sys.includes("sentiment analyst"))
      return { source: "sentiment", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
    throw new Error(`unrouted system prompt: ${sys.slice(0, 60)}`);
  };
}

async function makeFixtureDir(): Promise<{
  barsDir: string;
  headlines: string;
  calendar: string;
  out: string;
  cacheDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "eval-cli-"));
  const barsDir = join(root, "bars");
  const out = join(root, "out");
  const cacheDir = join(root, "cache");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(barsDir, { recursive: true });

  const bars = buildBars();
  const csv = barsToCsv(bars);
  for (const tf of ["M15", "H1", "H4", "D1"]) {
    await writeFile(join(barsDir, `EURUSD-${tf}.csv`), csv, "utf8");
  }

  const headlines: NewsHeadline[] = [
    { ts: START_MS - 3600_000, source: "fixture", title: "EUR sentiment update" },
  ];
  const calendar: CalendarEvent[] = [
    {
      ts: START_MS + 5 * HOUR_MS,
      currency: "USD",
      impact: "medium",
      title: "Test medium event",
    },
  ];
  const headlinesPath = join(root, "headlines.json");
  const calendarPath = join(root, "calendar.json");
  await writeFile(headlinesPath, JSON.stringify(headlines), "utf8");
  await writeFile(calendarPath, JSON.stringify(calendar), "utf8");

  return { barsDir, headlines: headlinesPath, calendar: calendarPath, out, cacheDir };
}

describe("eval-replay CLI", () => {
  it("runs end-to-end and writes report.md + report.json", async () => {
    const { barsDir, headlines, calendar, out, cacheDir } = await makeFixtureDir();
    const llm = new FakeLlm({ route: consensusLongRoute() });

    await runCli(
      [
        "--symbols",
        "EURUSD",
        "--start",
        new Date(START_MS).toISOString(),
        "--end",
        new Date(END_MS).toISOString(),
        "--bars-dir",
        barsDir,
        "--headlines",
        headlines,
        "--calendar",
        calendar,
        "--mode",
        "cheap",
        "--cache-dir",
        cacheDir,
        "--out",
        out,
        "--consensus-threshold",
        "0.7",
        "--starting-equity",
        "10000",
        "--step-ms",
        String(HOUR_MS),
      ],
      { overrideLlm: llm },
    );

    const md = await readFile(join(out, "report.md"), "utf8");
    expect(md).toContain("# Replay Report");

    const jsonRaw = await readFile(join(out, "report.json"), "utf8");
    const json = JSON.parse(jsonRaw) as {
      metrics: { tradeCount: number };
      symbols: readonly string[];
    };
    expect(json.metrics.tradeCount).toBeGreaterThanOrEqual(1);
    expect(json.symbols).toEqual(["EURUSD"]);
  });

  it("prints help on --help and exits cleanly", async () => {
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runCli(["--help"]);
    } finally {
      process.stdout.write = orig;
    }
    expect(writes.join("")).toContain("Usage: eval-replay");
  });
});
