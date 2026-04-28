import type { NewsHeadline } from "@forex-bot/contracts";
import type { FetchWindow, NewsAdapter } from "@forex-bot/data-core";

interface NewsApiArticle {
  source: { name: string };
  title: string;
  description?: string;
  publishedAt: string;
}

interface NewsApiResponse {
  status: string;
  articles: readonly NewsApiArticle[];
}

export interface NewsApiAdapterOptions {
  apiKey: string;
  query: string;
  fetcher?: (url: string) => Promise<NewsApiResponse>;
}

export class NewsApiAdapter implements NewsAdapter {
  readonly source = "newsapi";
  private readonly apiKey: string;
  private readonly query: string;
  private readonly fetcher: (url: string) => Promise<NewsApiResponse>;

  constructor(opts: NewsApiAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.query = opts.query;
    this.fetcher =
      opts.fetcher ??
      (async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`NewsAPI ${u} failed: ${r.status}`);
        return (await r.json()) as NewsApiResponse;
      });
  }

  async fetch(window: FetchWindow): Promise<readonly NewsHeadline[]> {
    const url =
      `https://newsapi.org/v2/everything` +
      `?apiKey=${encodeURIComponent(this.apiKey)}` +
      `&q=${encodeURIComponent(this.query)}` +
      `&from=${new Date(window.since).toISOString()}` +
      `&sortBy=publishedAt`;
    const json = await this.fetcher(url);
    if (json.status !== "ok") throw new Error(`NewsAPI returned status: ${json.status}`);
    const out: NewsHeadline[] = [];
    for (const a of json.articles) {
      const ts = Date.parse(a.publishedAt);
      if (!Number.isFinite(ts) || ts < window.since) continue;
      if (window.until !== undefined && ts > window.until) continue;
      out.push({
        ts,
        source: `newsapi:${a.source.name}`,
        title: a.title,
        ...(a.description ? { summary: a.description } : {}),
      });
    }
    return out;
  }
}
