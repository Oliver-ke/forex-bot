import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { TradeJournal } from "@forex-bot/contracts";
import type { JournalStore } from "@forex-bot/data-core";

export interface DynamoJournalStoreOptions {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class DynamoJournalStore implements JournalStore {
  private readonly tableName: string;
  private readonly raw: DynamoDBClient;
  private readonly doc: DynamoDBDocumentClient;

  constructor(opts: DynamoJournalStoreOptions) {
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

  async put(j: TradeJournal): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: { ...j } }));
  }

  async get(tradeId: string): Promise<TradeJournal | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { tradeId } }));
    return r.Item ? (r.Item as TradeJournal) : undefined;
  }

  async list(opts: { limit: number; cursor?: string }): Promise<{
    items: readonly TradeJournal[];
    nextCursor?: string;
  }> {
    const r = await this.doc.send(new ScanCommand({ TableName: this.tableName, Limit: 200 }));
    const all = ((r.Items ?? []) as TradeJournal[]).slice().sort((a, b) => b.openedAt - a.openedAt);
    const startIdx = opts.cursor ? Number(opts.cursor) : 0;
    const end = startIdx + opts.limit;
    const items = all.slice(startIdx, end);
    const nextCursor = end < all.length ? String(end) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  }
}
