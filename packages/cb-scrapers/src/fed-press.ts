import type { CbAdapter, CbDocument, FetchWindow } from "@forex-bot/data-core";
import { parseHTML } from "linkedom";
import Parser from "rss-parser";

const FEED_URL = "https://www.federalreserve.gov/feeds/press_all.xml";

export interface FedPressAdapterOptions {
  feedUrl?: string;
  feedFetcher?: (url: string) => Promise<string>;
  pageFetcher?: (url: string) => Promise<string>;
}

export class FedPressAdapter implements CbAdapter {
  readonly source = "fed-press";
  private readonly feedUrl: string;
  private readonly feedFetcher: (url: string) => Promise<string>;
  private readonly pageFetcher: (url: string) => Promise<string>;
  private readonly parser = new Parser();

  constructor(opts: FedPressAdapterOptions = {}) {
    this.feedUrl = opts.feedUrl ?? FEED_URL;
    this.feedFetcher = opts.feedFetcher ?? defaultTextFetch;
    this.pageFetcher = opts.pageFetcher ?? defaultTextFetch;
  }

  async fetch(window: FetchWindow): Promise<readonly CbDocument[]> {
    const xml = await this.feedFetcher(this.feedUrl);
    const parsed = await this.parser.parseString(xml);
    const out: CbDocument[] = [];
    for (const item of parsed.items ?? []) {
      const ts = item.isoDate
        ? Date.parse(item.isoDate)
        : item.pubDate
          ? Date.parse(item.pubDate)
          : 0;
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      const url = item.link ?? "";
      const body = url ? extractText(await this.pageFetcher(url)) : "";
      out.push({
        ts,
        bank: "FED",
        kind: "press_release",
        title: item.title?.trim() ?? "",
        url,
        body,
      });
    }
    return out;
  }
}

async function defaultTextFetch(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} failed: ${r.status}`);
  return r.text();
}

function extractText(html: string): string {
  const { document } = parseHTML(html);
  const article = document.querySelector(".article") ?? document.body;
  if (!article) return "";
  return Array.from(article.querySelectorAll("p") as Iterable<{ textContent: string | null }>)
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}
