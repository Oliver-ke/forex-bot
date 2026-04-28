import { describe, expect, it } from "vitest";
import { NewsApiAdapter } from "../src/newsapi-adapter.js";

const SAMPLE = {
  status: "ok",
  totalResults: 2,
  articles: [
    {
      source: { id: null, name: "Reuters" },
      author: "Foo",
      title: "Fed holds rates steady",
      description: "Summary",
      url: "https://example/a1",
      publishedAt: "2025-04-01T12:00:00Z",
      content: "...",
    },
    {
      source: { id: null, name: "FT" },
      author: "Bar",
      title: "ECB hints at cut",
      description: "Summary 2",
      url: "https://example/a2",
      publishedAt: "2025-04-01T14:00:00Z",
      content: "...",
    },
  ],
};

describe("NewsApiAdapter", () => {
  it("calls newsapi with apiKey + q and parses articles", async () => {
    const calls: string[] = [];
    const adapter = new NewsApiAdapter({
      apiKey: "k",
      query: "forex OR EURUSD",
      fetcher: async (url) => {
        calls.push(url);
        return SAMPLE;
      },
    });
    const out = await adapter.fetch({ since: 0 });
    expect(out).toHaveLength(2);
    expect(calls[0]).toContain("apiKey=k");
    expect(decodeURIComponent(calls[0] ?? "")).toContain("forex OR EURUSD");
  });

  it("filters by since", async () => {
    const adapter = new NewsApiAdapter({
      apiKey: "k",
      query: "forex",
      fetcher: async () => SAMPLE,
    });
    const out = await adapter.fetch({ since: Date.UTC(2025, 3, 1, 13, 0) });
    expect(out.map((h) => h.title)).toEqual(["ECB hints at cut"]);
  });
});
