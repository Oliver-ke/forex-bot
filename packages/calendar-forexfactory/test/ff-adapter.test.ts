import { describe, expect, it } from "vitest";
import { ForexFactoryCalendarAdapter } from "../src/ff-adapter.js";

const SAMPLE = [
  {
    title: "Non-Farm Employment Change",
    country: "USD",
    date: "2025-04-04T12:30:00Z",
    impact: "High",
    forecast: "200K",
    previous: "150K",
    actual: "",
  },
  {
    title: "ECB Rate Decision",
    country: "EUR",
    date: "2025-04-10T11:45:00Z",
    impact: "High",
    forecast: "3.50%",
    previous: "3.50%",
    actual: "",
  },
  {
    title: "Bank Holiday",
    country: "JPY",
    date: "2025-04-29T00:00:00Z",
    impact: "Holiday",
    forecast: "",
    previous: "",
    actual: "",
  },
];

describe("ForexFactoryCalendarAdapter", () => {
  it("maps impact + currency and skips holidays", async () => {
    const adapter = new ForexFactoryCalendarAdapter({ fetcher: async () => SAMPLE });
    const out = await adapter.fetch({ since: 0 });
    expect(out).toHaveLength(2);
    const nfp = out.find((e) => e.title.includes("Non-Farm"));
    expect(nfp?.currency).toBe("USD");
    expect(nfp?.impact).toBe("high");
  });

  it("filters by since", async () => {
    const adapter = new ForexFactoryCalendarAdapter({ fetcher: async () => SAMPLE });
    const out = await adapter.fetch({ since: Date.UTC(2025, 3, 5) });
    expect(out.map((e) => e.title)).toContain("ECB Rate Decision");
    expect(out.map((e) => e.title)).not.toContain("Non-Farm Employment Change");
  });
});
