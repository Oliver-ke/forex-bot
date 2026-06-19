import type { Symbol } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { MT5Broker } from "../src/adapter.js";
import type { MT5Client } from "../src/generated/mt5.js";

type Cb<T> = (err: null, res: T) => void;

/** Minimal stub MT5Client that records outbound requests and returns canned data. */
function stubClient(captured: Record<string, unknown>): MT5Client {
  return {
    // Signature matches the grpc-js unary overload the adapter now uses:
    // (request, metadata, options, callback). The adapter passes a per-call
    // deadline via `options`; the stub ignores meta/opts.
    getQuote: (req: { symbol: string }, _meta: unknown, _opts: unknown, cb: Cb<unknown>) => {
      captured.quote = req;
      // Broker echoes the (suffixed) symbol back, as MetaApi would.
      cb(null, { ts: 1n, symbol: req.symbol, bid: 1.1, ask: 1.2 });
    },
    getCandles: (req: { symbol: string }, _meta: unknown, _opts: unknown, cb: Cb<unknown>) => {
      captured.candles = req;
      cb(null, { candles: [] });
    },
  } as unknown as MT5Client;
}

describe("MT5Broker symbol-suffix mapping", () => {
  it("appends the suffix outbound and strips it inbound", async () => {
    const captured: Record<string, unknown> = {};
    const broker = new MT5Broker(stubClient(captured), true, "m");

    const t = await broker.getQuote("EURUSD" as Symbol);
    expect((captured.quote as { symbol: string }).symbol).toBe("EURUSDm"); // outbound append
    expect(t.symbol).toBe("EURUSD"); // inbound strip → canonical domain symbol

    await broker.getCandles("USDJPY" as Symbol, "H1", 10);
    expect((captured.candles as { symbol: string }).symbol).toBe("USDJPYm");
  });

  it("is identity when no suffix is configured (no regression)", async () => {
    const captured: Record<string, unknown> = {};
    const broker = new MT5Broker(stubClient(captured), true);

    const t = await broker.getQuote("EURUSD" as Symbol);
    expect((captured.quote as { symbol: string }).symbol).toBe("EURUSD");
    expect(t.symbol).toBe("EURUSD");
  });
});
