import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { TradeJournal } from "@forex-bot/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DynamoJournalStore } from "../src/dynamo-journal.js";

const ENDPOINT = process.env.DYNAMO_TEST_ENDPOINT ?? "";
const TABLE = "forex_bot_journal_test";

describe.skipIf(!ENDPOINT)("DynamoJournalStore (integration)", () => {
  let raw: DynamoDBClient;
  let store: DynamoJournalStore;

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
          AttributeDefinitions: [
            { AttributeName: "tradeId", AttributeType: "S" },
            { AttributeName: "openedAt", AttributeType: "N" },
          ],
          KeySchema: [{ AttributeName: "tradeId", KeyType: "HASH" }],
          GlobalSecondaryIndexes: [
            {
              IndexName: "byOpenedAt",
              KeySchema: [
                { AttributeName: "tradeId", KeyType: "HASH" },
                { AttributeName: "openedAt", KeyType: "RANGE" },
              ],
              Projection: { ProjectionType: "ALL" },
              ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
            },
          ],
          BillingMode: "PROVISIONED",
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }),
      );
    } catch {
      // table already exists
    }
    store = new DynamoJournalStore({
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

  it("put + get round-trips", async () => {
    const j: TradeJournal = {
      tradeId: `t-${Date.now()}`,
      symbol: "EURUSD",
      openedAt: Date.now(),
      verdict: { direction: "long", confidence: 0.7, horizon: "H1", reasoning: "x" },
      risk: { approve: true, lotSize: 0.1, sl: 1.07, tp: 1.09, expiresAt: 0, reasons: ["ok"] },
    };
    await store.put(j);
    const got = await store.get(j.tradeId);
    expect(got?.symbol).toBe("EURUSD");
  });
});
