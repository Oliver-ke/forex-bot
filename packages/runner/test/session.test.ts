import { describe, expect, it } from "vitest";
import { sessionForUtc } from "../src/session.js";

// Helper: build a UTC timestamp from year/month(0-based)/day/hour
const d = (y: number, mo: number, day: number, h: number) => Date.UTC(y, mo, day, h);

// Dates verified with getUTCDay():
//   Date.UTC(2026,4,18,*) → 2026-05-18, getUTCDay()=1 (Monday)
//   Date.UTC(2026,4,16,*) → 2026-05-16, getUTCDay()=6 (Saturday)
//   Date.UTC(2026,4,15,*) → 2026-05-15, getUTCDay()=5 (Friday)
//   Date.UTC(2026,4,17,*) → 2026-05-17, getUTCDay()=0 (Sunday)

describe("sessionForUtc", () => {
  // Required spec cases (verbatim from brief)
  it("Monday 02:00 UTC → asia", () => {
    expect(sessionForUtc(d(2026, 4, 18, 2))).toBe("asia");
  });

  it("Monday 08:00 UTC → london", () => {
    expect(sessionForUtc(d(2026, 4, 18, 8))).toBe("london");
  });

  it("Monday 13:00 UTC → overlap_ny_london", () => {
    expect(sessionForUtc(d(2026, 4, 18, 13))).toBe("overlap_ny_london");
  });

  it("Monday 18:00 UTC → ny", () => {
    expect(sessionForUtc(d(2026, 4, 18, 18))).toBe("ny");
  });

  it("Saturday 12:00 UTC → off", () => {
    expect(sessionForUtc(d(2026, 4, 16, 12))).toBe("off");
  });

  // Additional boundary checks
  it("Friday 21:00 UTC → off (Friday market close)", () => {
    expect(sessionForUtc(d(2026, 4, 15, 21))).toBe("off");
  });

  it("Sunday 20:00 UTC → off (Sunday before market opens)", () => {
    expect(sessionForUtc(d(2026, 4, 17, 20))).toBe("off");
  });

  it("Sunday 22:00 UTC → asia (market reopens at 22:00)", () => {
    expect(sessionForUtc(d(2026, 4, 17, 22))).toBe("asia");
  });

  it("Monday 12:00 UTC → overlap_ny_london (start of overlap)", () => {
    expect(sessionForUtc(d(2026, 4, 18, 12))).toBe("overlap_ny_london");
  });

  it("Monday 16:00 UTC → ny (overlap ends, ny continues)", () => {
    expect(sessionForUtc(d(2026, 4, 18, 16))).toBe("ny");
  });

  it("Monday 21:00 UTC → off (ny session ends, before asia opens)", () => {
    expect(sessionForUtc(d(2026, 4, 18, 21))).toBe("off");
  });
});
