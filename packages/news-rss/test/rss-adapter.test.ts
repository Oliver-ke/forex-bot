import { describe, expect, it } from "vitest";
import { RssNewsAdapter } from "../src/rss-adapter.js";

const SAMPLE_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Sample Feed</title>
  <item>
    <title>Fed holds rates</title>
    <link>https://example/fed1</link>
    <pubDate>Tue, 01 Apr 2025 12:00:00 GMT</pubDate>
    <description>Description text</description>
  </item>
  <item>
    <title>ECB hints at cut</title>
    <link>https://example/ecb1</link>
    <pubDate>Tue, 01 Apr 2025 14:00:00 GMT</pubDate>
    <description>Another description</description>
  </item>
</channel></rss>`;

describe("RssNewsAdapter", () => {
  it("parses a feed and returns NewsHeadline items", async () => {
    const adapter = new RssNewsAdapter({
      source: "test-rss",
      feedUrl: "https://example/feed.rss",
      fetcher: async () => SAMPLE_FEED,
    });
    const items = await adapter.fetch({ since: 0 });
    expect(items).toHaveLength(2);
    const titles = items.map((i) => i.title);
    expect(titles).toContain("Fed holds rates");
  });

  it("filters items by `since`", async () => {
    const adapter = new RssNewsAdapter({
      source: "test-rss",
      feedUrl: "https://example/feed.rss",
      fetcher: async () => SAMPLE_FEED,
    });
    const since = Date.UTC(2025, 3, 1, 13, 0, 0);
    const items = await adapter.fetch({ since });
    expect(items.map((i) => i.title)).toEqual(["ECB hints at cut"]);
  });
});
