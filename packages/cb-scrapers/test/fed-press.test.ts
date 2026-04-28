import { describe, expect, it } from "vitest";
import { FedPressAdapter } from "../src/fed-press.js";

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>FOMC statement: rates unchanged</title>
    <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20250320a.htm</link>
    <pubDate>Wed, 20 Mar 2025 18:00:00 GMT</pubDate>
    <description>FOMC press release.</description>
  </item>
</channel></rss>`;

const PAGE = `<!doctype html><html><body>
  <div class="article">
    <p>The Federal Open Market Committee decided today to maintain the target range...</p>
    <p>In assessing the appropriate stance...</p>
  </div>
</body></html>`;

describe("FedPressAdapter", () => {
  it("emits a CbDocument with normalized body text", async () => {
    const adapter = new FedPressAdapter({
      feedFetcher: async () => FEED,
      pageFetcher: async () => PAGE,
    });
    const docs = await adapter.fetch({ since: 0 });
    expect(docs).toHaveLength(1);
    const d = docs[0];
    expect(d?.bank).toBe("FED");
    expect(d?.kind).toBe("press_release");
    expect(d?.body).toContain("Federal Open Market Committee");
    expect(d?.body).not.toContain("<p>");
  });
});
