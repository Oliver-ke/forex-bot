import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEventFixture } from "../src/event-fixture.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "library");

describe("event-study library", () => {
  it("NFP fixture parses", async () => {
    const f = await loadEventFixture(join(LIB, "2024-q4-nfp.json"));
    expect(f.id).toMatch(/nfp/i);
    expect(f.symbol).toBe("EURUSD");
    expect(f.bars.M15.length).toBeGreaterThanOrEqual(1);
    expect(f.bars.H1.length).toBeGreaterThanOrEqual(1);
    expect(f.bars.H4.length).toBeGreaterThanOrEqual(1);
    expect(f.bars.D1.length).toBeGreaterThanOrEqual(1);
    expect(f.upcomingEvents.some((e) => /payroll/i.test(e.title))).toBe(true);
  });

  it("FOMC fixture parses", async () => {
    const f = await loadEventFixture(join(LIB, "2024-q4-fomc.json"));
    expect(f.id).toMatch(/fomc/i);
    expect(f.symbol).toBe("EURUSD");
    expect(f.upcomingEvents.some((e) => /fomc|fed|rate decision/i.test(e.title))).toBe(true);
  });

  it("SNB unpeg fixture parses with realized range >= 1500 pips", async () => {
    const f = await loadEventFixture(join(LIB, "2015-snb-unpeg.json"));
    expect(f.id).toMatch(/snb/i);
    expect(f.symbol).toBe("EURCHF");
    expect(f.realized.rangePips).toBeGreaterThanOrEqual(1500);
    expect(f.expected?.direction).toBe("short");
  });
});
