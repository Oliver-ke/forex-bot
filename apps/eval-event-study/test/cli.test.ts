import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

/**
 * Routes by inspecting the request's system prompt — same pattern used in
 * `packages/eval-event-study/test/runner.test.ts`. Drives the consensus path
 * with a long bias and approves at the Risk Officer.
 */
function consensusLongRoute(req: StructuredRequest<unknown>): unknown {
  const sys = req.system;
  if (sys.includes("Risk Officer")) {
    return {
      approve: true,
      lotSize: 0.05,
      sl: 1.0,
      tp: 1.1,
      expiresAt: 9_999_999_999_999,
      reasons: ["risk-officer: ok"],
    };
  }
  if (sys.includes("Judge")) {
    return {
      direction: "long",
      confidence: 0.7,
      horizon: "H1",
      reasoning: "judge synthesized long",
      debated: true,
    };
  }
  if (sys.includes("Bull-side debater")) {
    return { side: "bull", arguments: ["bull arg"], risks: ["r"], counters: ["c"] };
  }
  if (sys.includes("Bear-side debater")) {
    return { side: "bear", arguments: ["bear arg"], risks: ["r"], counters: ["c"] };
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
  throw new Error(`unrouted system prompt: ${sys.slice(0, 80)}`);
}

describe("eval-event-study CLI", () => {
  it("runs --all against the canonical library and reports a per-fixture row + aggregate", async () => {
    const llm = new FakeLlm({ route: consensusLongRoute });
    const out: string[] = [];
    const err: string[] = [];

    const code = await runCli(["--all", "--mode=cheap"], {
      overrideLlm: llm,
      stdout: (c) => out.push(c),
      stderr: (c) => err.push(c),
    });

    const stdout = out.join("");

    // 3 canonical fixtures — one row per fixture plus an aggregate footer.
    const rowLines = stdout.split("\n").filter((l) => /^\[(PASS|FAIL)\]/.test(l));
    expect(rowLines).toHaveLength(3);

    // Aggregate footer must match `passed N/3 (X%)` and the count must equal
    // the number of [PASS] rows above.
    const passCount = rowLines.filter((l) => l.startsWith("[PASS]")).length;
    const aggregate = stdout.match(/passed (\d+)\/(\d+) \((\d+)%\)/);
    expect(aggregate).not.toBeNull();
    if (aggregate === null) throw new Error("unreachable");
    expect(aggregate[1]).toBe(String(passCount));
    expect(aggregate[2]).toBe("3");

    // Exit code mirrors all-pass semantics.
    expect(code).toBe(passCount === 3 ? 0 : 1);

    // Every row must include verdict, decision, and reasons fields.
    for (const line of rowLines) {
      expect(line).toMatch(/verdict=/);
      expect(line).toMatch(/decision=/);
      expect(line).toMatch(/reasons=/);
    }

    // Library has these three known fixture ids.
    expect(stdout).toContain("2024-q4-nfp");
    expect(stdout).toContain("2024-q4-fomc");
    expect(stdout).toContain("2015-snb-unpeg");
  });

  it("writes summary.md and summary.json when --out is given", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-event-study-cli-"));
    const llm = new FakeLlm({ route: consensusLongRoute });
    const out: string[] = [];

    const code = await runCli(["--all", "--mode=cheap", "--out", root], {
      overrideLlm: llm,
      stdout: (c) => out.push(c),
    });

    expect([0, 1]).toContain(code);

    const md = await readFile(join(root, "summary.md"), "utf8");
    expect(md).toContain("# Event-Study Summary");
    expect(md).toContain("2024-q4-nfp");

    const jsonRaw = await readFile(join(root, "summary.json"), "utf8");
    const json = JSON.parse(jsonRaw) as {
      aggregate: { passed: number; total: number; pct: number };
      rows: ReadonlyArray<{ id: string; pass: boolean }>;
    };
    expect(json.aggregate.total).toBe(3);
    expect(json.rows.map((r) => r.id).sort()).toEqual([
      "2015-snb-unpeg",
      "2024-q4-fomc",
      "2024-q4-nfp",
    ]);
  });

  it("returns a usage error code (2) when neither --id nor --all is passed", async () => {
    const err: string[] = [];
    const code = await runCli([], {
      stdout: () => undefined,
      stderr: (c) => err.push(c),
    });
    expect(code).toBe(2);
    expect(err.join("")).toContain("--id");
  });

  it("prints help on --help and returns 0", async () => {
    const out: string[] = [];
    const code = await runCli(["--help"], { stdout: (c) => out.push(c) });
    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: eval-event-study");
  });

  it("rejects cheap mode with no override and CHEAP_FAKE_LLM unset", async () => {
    const prev = process.env.CHEAP_FAKE_LLM;
    // biome-ignore lint/performance/noDelete: setting to "undefined" leaves a truthy string; we need the env var truly absent.
    delete process.env.CHEAP_FAKE_LLM;
    try {
      const err: string[] = [];
      const code = await runCli(["--all", "--mode=cheap"], {
        stdout: () => undefined,
        stderr: (c) => err.push(c),
      });
      expect(code).toBe(2);
      expect(err.join("")).toContain("CHEAP_FAKE_LLM");
    } finally {
      if (prev !== undefined) process.env.CHEAP_FAKE_LLM = prev;
    }
  });
});
