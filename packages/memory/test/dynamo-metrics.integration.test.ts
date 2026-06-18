import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { DailyMetricsSnapshot } from "@forex-bot/eval-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DynamoMetricsStore } from "../src/dynamo-metrics.js";

const ENDPOINT = process.env.DYNAMO_TEST_ENDPOINT ?? "";
const TABLE = "forex_bot_metrics_test";

describe.skipIf(!ENDPOINT)("DynamoMetricsStore (integration)", () => {
  let raw: DynamoDBClient;
  let store: DynamoMetricsStore;

  beforeAll(async () => {
    raw = new DynamoDBClient({
      ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    try {
      await raw.send(
        new CreateTableCommand({
          TableName: TABLE,
          AttributeDefinitions: [{ AttributeName: "dayMs", AttributeType: "N" }],
          KeySchema: [{ AttributeName: "dayMs", KeyType: "HASH" }],
          BillingMode: "PAY_PER_REQUEST",
        }),
      );
    } catch {
      // table already exists
    }
    store = new DynamoMetricsStore({
      tableName: TABLE,
      endpoint: ENDPOINT,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  });

  afterAll(async () => {
    raw.destroy();
    await store.close();
  });

  it("put + getDay round-trips", async () => {
    const snapshot: DailyMetricsSnapshot = {
      dayMs: 1_700_000_000_000,
      generatedAt: 1_700_000_001_000,
      metrics: {
        tradeCount: 2,
        winRate: 0.5,
        profitFactor: 1.2,
        expectancyR: 0.3,
        avgWinR: 0.6,
        avgLossR: -0.3,
        maxDrawdownPct: 0.05,
        sharpe: 0.8,
      },
      accuracy: {
        directionalHitRate: 0.5,
        winRate: 0.5,
        expectancyR: 0.3,
      },
      decisions: {
        ticks: 10,
        approved: 3,
        vetoed: 2,
        consensus: 2,
        debated: 1,
        judgeOverrideOfDebate: 0,
        riskOfficerOverride: 0,
      },
      llmSpendUsd: 0.042,
      perSession: {
        asia: { trades: 1, pnl: 10, winRate: 1 },
        london: { trades: 1, pnl: -5, winRate: 0 },
        ny: { trades: 0, pnl: 0, winRate: 0 },
        overlap_ny_london: { trades: 0, pnl: 0, winRate: 0 },
        off: { trades: 0, pnl: 0, winRate: 0 },
      },
      perRegime: {
        trending: { trades: 1, pnl: 10 },
        ranging: { trades: 1, pnl: -5 },
        "event-driven": { trades: 0, pnl: 0 },
        "risk-off": { trades: 0, pnl: 0 },
      },
    };

    await store.put(snapshot);
    const got = await store.getDay(snapshot.dayMs);
    expect(got?.dayMs).toBe(snapshot.dayMs);
    expect(got?.llmSpendUsd).toBe(snapshot.llmSpendUsd);
    expect(got?.accuracy.directionalHitRate).toBe(0.5);
  });

  it("list includes the inserted snapshot", async () => {
    const result = await store.list({ limit: 10 });
    const found = result.items.some((s) => s.dayMs === 1_700_000_000_000);
    expect(found).toBe(true);
  });
});
