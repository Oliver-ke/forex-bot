import { describe, expect, it } from "vitest";
import { makeTracer } from "../src/langsmith.js";
import { type LogEntry, Logger } from "../src/logger.js";

describe("Logger", () => {
  it("emits structured entries with deterministic ts and merged base fields", () => {
    const captured: LogEntry[] = [];
    const log = new Logger({
      out: (e) => captured.push(e),
      base: { service: "agent-runner" },
      now: () => 42,
    });
    log.info("tick", { symbol: "EURUSD" });
    log.warn("slow", { latencyMs: 1200 });
    log.error("boom", { err: "bad" });
    expect(captured).toHaveLength(3);
    expect(captured[0]).toEqual({
      level: "info",
      ts: 42,
      msg: "tick",
      fields: { service: "agent-runner", symbol: "EURUSD" },
    });
    expect(captured[1]?.level).toBe("warn");
    expect(captured[2]?.level).toBe("error");
  });

  it("omits fields when none are provided and no base is set", () => {
    const captured: LogEntry[] = [];
    const log = new Logger({ out: (e) => captured.push(e), now: () => 0 });
    log.info("hi");
    expect(captured[0]).toEqual({ level: "info", ts: 0, msg: "hi" });
  });
});

describe("makeTracer", () => {
  it("returns a no-op tracer when no API key is set", async () => {
    const t = makeTracer({ apiKey: "" });
    expect(t.enabled).toBe(false);
    const r = await t.traceRun("op", async () => 7);
    expect(r).toBe(7);
  });

  it("returns an enabled tracer when an API key is provided", () => {
    const t = makeTracer({ apiKey: "fake" });
    expect(t.enabled).toBe(true);
  });
});
