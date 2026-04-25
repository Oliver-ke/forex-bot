import { describe, expect, it } from "vitest";
import { KillSwitch, type KillSwitchState } from "../src/kill-switch.js";

describe("KillSwitch", () => {
  it("starts untripped", () => {
    const ks = new KillSwitch();
    expect(ks.state().tripped).toBe(false);
  });

  it("auto-trips on daily DD exceeded", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: -3.5, totalDdPct: -2, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    expect(ks.state().reason).toContain("daily");
  });

  it("trips on total drawdown exceeded", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: 0, totalDdPct: -10, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    expect(ks.state().reason).toContain("drawdown");
  });

  it("trips on consecutive losses exceeded", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: 0, totalDdPct: 0, consecutiveLosses: 5, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    expect(ks.state().reason).toContain("consecutive");
  });

  it("trips on stale feed", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: 0, totalDdPct: 0, consecutiveLosses: 0, lastFeedAgeSec: 60 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    expect(ks.state().reason).toContain("feed");
  });

  it("requires explicit reset()", () => {
    const ks = new KillSwitch();
    ks.observe({ dailyPnlPct: -10, totalDdPct: 0, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true);
    ks.observe({ dailyPnlPct: 0, totalDdPct: 0, consecutiveLosses: 0, lastFeedAgeSec: 1 }, {
      maxDailyLossPct: 3, maxTotalDrawdownPct: 8, maxConsecutiveLosses: 4, feedStaleSec: 30,
    });
    expect(ks.state().tripped).toBe(true); // still tripped
    ks.reset();
    expect(ks.state().tripped).toBe(false);
  });

  it("serializes and rehydrates state", () => {
    const ks = new KillSwitch({ tripped: true, reason: "manual", trippedAt: 123 } satisfies KillSwitchState);
    expect(ks.state().tripped).toBe(true);
  });
});
