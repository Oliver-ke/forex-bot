import { describe, expect, it } from "vitest";
import { CftcCotAdapter, type CftcRawRow } from "../src/cftc-adapter.js";

const SAMPLE: CftcRawRow[] = [
  {
    ts: Date.UTC(2025, 3, 4, 19, 30),
    contract: "EURO FX",
    netNonCommercial: 100_000,
    netCommercial: -120_000,
    weeklyChangeNonCommercial: 5_000,
  },
  {
    ts: Date.UTC(2025, 3, 4, 19, 30),
    contract: "BRITISH POUND",
    netNonCommercial: 50_000,
    netCommercial: -60_000,
    weeklyChangeNonCommercial: -2_000,
  },
];

describe("CftcCotAdapter", () => {
  it("maps CFTC contract names to symbols", async () => {
    const a = new CftcCotAdapter({ fetcher: async () => SAMPLE });
    const out = await a.fetch({ since: 0 });
    expect(out.find((r) => r.symbol === "EURUSD")?.netNonCommercial).toBe(100_000);
    expect(out.find((r) => r.symbol === "GBPUSD")).toBeDefined();
  });

  it("skips contracts without a known symbol mapping", async () => {
    const first = SAMPLE[0] as CftcRawRow;
    const adapter = new CftcCotAdapter({
      fetcher: async () => [{ ...first, contract: "MYSTERY" }],
    });
    expect(await adapter.fetch({ since: 0 })).toHaveLength(0);
  });
});
