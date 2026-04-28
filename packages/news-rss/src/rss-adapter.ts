import type { NewsHeadline } from "@forex-bot/contracts";
import type { FetchWindow, NewsAdapter } from "@forex-bot/data-core";
import Parser from "rss-parser";

export interface RssNewsAdapterOptions {
  source: string;
  feedUrl: string;
  fetcher?: (url: string) => Promise<string>;
}

export class RssNewsAdapter implements NewsAdapter {
  readonly source: string;
  private readonly feedUrl: string;
  private readonly fetcher: (url: string) => Promise<string>;
  private readonly parser = new Parser();

  constructor(opts: RssNewsAdapterOptions) {
    this.source = opts.source;
    this.feedUrl = opts.feedUrl;
    this.fetcher =
      opts.fetcher ??
      (async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`RSS ${u} failed: ${r.status}`);
        return r.text();
      });
  }

  async fetch(window: FetchWindow): Promise<readonly NewsHeadline[]> {
    const xml = await this.fetcher(this.feedUrl);
    const parsed = await this.parser.parseString(xml);
    const out: NewsHeadline[] = [];
    for (const item of parsed.items ?? []) {
      const ts = item.isoDate
        ? Date.parse(item.isoDate)
        : item.pubDate
          ? Date.parse(item.pubDate)
          : 0;
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      out.push({
        ts,
        source: this.source,
        title: item.title?.trim() ?? "",
        ...(item.contentSnippet ? { summary: item.contentSnippet.trim() } : {}),
      });
    }
    return out;
  }
}
