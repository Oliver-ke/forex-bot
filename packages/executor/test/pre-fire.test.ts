import { describe, expect, it } from "vitest";
import { preFire } from "../src/pre-fire.js";

const base = {
  currentSpreadPips: 1.0,
  medianSpreadPips: 1.0,
  maxSpreadMultiplier: 2.0,
  freeMargin: 10_000,
  estimatedRequiredMargin: 500,
  feedAgeSec: 1,
  maxFeedAgeSec: 30,
};

describe("preFire", () => {
  it("passes on a healthy snapshot", () => {
    const r = preFire(base);
    expect(r.pass).toBe(true);
  });

  it("blocks when spread exceeds median × multiplier", () => {
    const r = preFire({ ...base, currentSpreadPips: 3 });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/spread/i);
  });

  it("blocks when feed is stale", () => {
    const r = preFire({ ...base, feedAgeSec: 60 });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/feed/i);
  });

  it("blocks when free margin would dip below 1.5× required", () => {
    const r = preFire({ ...base, freeMargin: 500, estimatedRequiredMargin: 400 });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/margin/i);
  });
});
