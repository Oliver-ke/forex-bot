import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DailyMetricsSnapshot, MetricsStore } from "@forex-bot/eval-core";

export interface DynamoMetricsStoreOptions {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class DynamoMetricsStore implements MetricsStore {
  private readonly tableName: string;
  private readonly raw: DynamoDBClient;
  private readonly doc: DynamoDBDocumentClient;

  constructor(opts: DynamoMetricsStoreOptions) {
    this.tableName = opts.tableName;
    this.raw = new DynamoDBClient({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    });
    this.doc = DynamoDBDocumentClient.from(this.raw);
  }

  async close(): Promise<void> {
    this.raw.destroy();
  }

  async put(snapshot: DailyMetricsSnapshot): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: { ...snapshot } }));
  }

  async getDay(dayMs: number): Promise<DailyMetricsSnapshot | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { dayMs } }));
    return r.Item ? (r.Item as DailyMetricsSnapshot) : undefined;
  }

  async list(opts: { limit: number; cursor?: string }): Promise<{
    items: readonly DailyMetricsSnapshot[];
    nextCursor?: string;
  }> {
    const r = await this.doc.send(new ScanCommand({ TableName: this.tableName, Limit: 200 }));
    const all = ((r.Items ?? []) as DailyMetricsSnapshot[])
      .slice()
      .sort((a, b) => b.dayMs - a.dayMs);
    const startIdx = opts.cursor ? Number(opts.cursor) : 0;
    const end = startIdx + opts.limit;
    const items = all.slice(startIdx, end);
    const nextCursor = end < all.length ? String(end) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  }
}
