import type { Server } from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MT5Broker } from "../src/adapter.js";
import { createMT5Client } from "../src/client.js";
import { startFakeServer } from "./helpers/fake-server.js";

let server: Server;
let broker: MT5Broker;

beforeAll(async () => {
  const s = await startFakeServer();
  server = s.server;
  broker = new MT5Broker(createMT5Client({ host: "127.0.0.1", port: s.port }));
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.tryShutdown(() => resolve());
    }),
);

describe("MT5Broker (over fake server)", () => {
  it("getQuote round-trips Tick", async () => {
    const t = await broker.getQuote("EURUSD");
    expect(t.bid).toBe(1.0801);
    expect(t.ask).toBe(1.0803);
  });

  it("getQuote on unknown symbol throws BrokerNotFoundError", async () => {
    await expect(broker.getQuote("XAUUSD")).rejects.toThrow(/no quote/);
  });

  it("placeOrder market + getOpenPositions", async () => {
    const r = await broker.placeOrder({
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      type: "market",
      sl: 1.075,
      tp: 1.085,
    });
    expect(r.ticket).toBeTruthy();
    expect(r.fillPrice).toBe(1.0803);
    const positions = await broker.getOpenPositions();
    expect(positions.some((p) => p.id === r.ticket)).toBe(true);
  });

  it("closePosition removes the ticket", async () => {
    const placed = await broker.placeOrder({
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      type: "market",
      sl: 1.075,
      tp: 1.085,
    });
    await broker.closePosition(placed.ticket);
    const positions = await broker.getOpenPositions();
    expect(positions.some((p) => p.id === placed.ticket)).toBe(false);
  });
});
