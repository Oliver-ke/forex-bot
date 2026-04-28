import { MT5Broker, createMT5Client } from "@forex-bot/broker-mt5";
import type { Server } from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute } from "../src/execute.js";
import { startFakeServer } from "./helpers/fake-server.js";

const NOW = 1_700_000_000_000;

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

describe("executor + MT5Broker (fake server)", () => {
  it("submits + reaches filled state", async () => {
    const result = await execute(
      {
        now: NOW,
        correlationId: "c-1",
        decision: {
          approve: true,
          lotSize: 0.1,
          sl: 1.075,
          tp: 1.085,
          expiresAt: NOW + 60_000,
          reasons: ["ok"],
        },
        order: {
          symbol: "EURUSD",
          side: "buy",
          lotSize: 0.1,
          entry: 1.08,
          sl: 1.075,
          tp: 1.085,
          expiresAt: NOW + 60_000,
        },
        preFire: {
          currentSpreadPips: 1,
          medianSpreadPips: 1,
          maxSpreadMultiplier: 2,
          freeMargin: 10_000,
          estimatedRequiredMargin: 500,
          feedAgeSec: 1,
          maxFeedAgeSec: 30,
        },
      },
      broker,
    );
    expect(result.approved).toBe(true);
    expect(result.record.state).toBe("filled");
    expect(result.record.ticket).toBeTruthy();
  });
});
