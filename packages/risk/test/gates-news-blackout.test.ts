import { describe, expect, it } from "vitest";
import { newsBlackoutGate } from "../src/gates/news-blackout.js";
import { mkGateCtx } from "./helpers/ctx.js";

const NOW = 1_700_000_000_000;

describe("newsBlackoutGate", () => {
  it("blocks within blackout window for affected currency", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        order: { ...mkGateCtx().order, symbol: "EURUSD" },
        upcomingEvents: [
          { ts: NOW + 5 * 60_000, currency: "USD", impact: "high", title: "CPI" },
        ],
      }),
    );
    expect(r.pass).toBe(false);
  });

  it("allows outside window", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        upcomingEvents: [
          { ts: NOW + 60 * 60_000, currency: "USD", impact: "high", title: "CPI" },
        ],
      }),
    );
    expect(r.pass).toBe(true);
  });

  it("ignores low-impact events", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        upcomingEvents: [
          { ts: NOW + 2 * 60_000, currency: "USD", impact: "low", title: "x" },
        ],
      }),
    );
    expect(r.pass).toBe(true);
  });

  it("ignores unaffected currencies", () => {
    const r = newsBlackoutGate(
      mkGateCtx({
        now: NOW,
        order: { ...mkGateCtx().order, symbol: "EURUSD" },
        upcomingEvents: [
          { ts: NOW + 2 * 60_000, currency: "JPY", impact: "high", title: "x" },
        ],
      }),
    );
    expect(r.pass).toBe(true);
  });
});
