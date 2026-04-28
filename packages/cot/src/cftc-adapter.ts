import type { Symbol } from "@forex-bot/contracts";
import type { CotAdapter, CotReport, FetchWindow } from "@forex-bot/data-core";

export interface CftcRawRow {
  ts: number;
  contract: string;
  netNonCommercial: number;
  netCommercial: number;
  weeklyChangeNonCommercial: number;
}

export interface CftcCotAdapterOptions {
  fetcher: () => Promise<readonly CftcRawRow[]>;
}

const CONTRACT_TO_SYMBOL: Record<string, Symbol> = {
  "EURO FX": "EURUSD",
  "BRITISH POUND": "GBPUSD",
  "JAPANESE YEN": "USDJPY",
  "AUSTRALIAN DOLLAR": "AUDUSD",
  "NEW ZEALAND DOLLAR": "NZDUSD",
  "CANADIAN DOLLAR": "USDCAD",
  "SWISS FRANC": "USDCHF",
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
};

export class CftcCotAdapter implements CotAdapter {
  readonly source = "cftc-cot";
  private readonly fetcher: () => Promise<readonly CftcRawRow[]>;

  constructor(opts: CftcCotAdapterOptions) {
    this.fetcher = opts.fetcher;
  }

  async fetch(window: FetchWindow): Promise<readonly CotReport[]> {
    const rows = await this.fetcher();
    const out: CotReport[] = [];
    for (const r of rows) {
      if (r.ts < window.since) continue;
      if (window.until !== undefined && r.ts > window.until) continue;
      const symbol = CONTRACT_TO_SYMBOL[r.contract];
      if (!symbol) continue;
      out.push({
        ts: r.ts,
        symbol,
        netNonCommercial: r.netNonCommercial,
        netCommercial: r.netCommercial,
        changeWeekly: r.weeklyChangeNonCommercial,
      });
    }
    return out;
  }
}
