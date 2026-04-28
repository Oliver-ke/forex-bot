import type { RagDoc, RagStore } from "@forex-bot/data-core";
import { Client } from "pg";

export interface PgvectorRagStoreOptions {
  connectionString: string;
  dimension: number;
}

export class PgvectorRagStore implements RagStore {
  private readonly client: Client;
  private readonly dimension: number;
  private connected = false;

  constructor(opts: PgvectorRagStoreOptions) {
    this.client = new Client({ connectionString: opts.connectionString });
    this.dimension = opts.dimension;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.end();
    this.connected = false;
  }

  async put(doc: RagDoc): Promise<void> {
    if (doc.embedding.length !== this.dimension) {
      throw new Error(`embedding length ${doc.embedding.length} != configured ${this.dimension}`);
    }
    await this.client.query(
      `INSERT INTO rag_docs (id, text, embedding, model_version, metadata, ts)
       VALUES ($1, $2, $3::vector, $4, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE
         SET text = EXCLUDED.text,
             embedding = EXCLUDED.embedding,
             model_version = EXCLUDED.model_version,
             metadata = EXCLUDED.metadata,
             ts = EXCLUDED.ts`,
      [
        doc.id,
        doc.text,
        toVectorLiteral(doc.embedding),
        doc.modelVersion,
        JSON.stringify(doc.metadata),
        doc.ts,
      ],
    );
  }

  async search(query: {
    embedding: readonly number[];
    k: number;
    filter?: Record<string, string>;
  }): Promise<readonly RagDoc[]> {
    if (query.embedding.length !== this.dimension) {
      throw new Error(
        `query embedding length ${query.embedding.length} != configured ${this.dimension}`,
      );
    }
    const params: unknown[] = [toVectorLiteral(query.embedding), query.k];
    let filterSql = "";
    if (query.filter && Object.keys(query.filter).length > 0) {
      filterSql = "WHERE metadata @> $3::jsonb";
      params.push(JSON.stringify(query.filter));
    }
    const sql = `
      SELECT id, text, embedding::text AS embedding, model_version, metadata, ts
      FROM rag_docs
      ${filterSql}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const result = await this.client.query(sql, params);
    return result.rows.map((r) => ({
      id: String(r.id),
      text: String(r.text),
      embedding: parseVectorLiteral(String(r.embedding)),
      modelVersion: String(r.model_version),
      metadata: r.metadata ?? {},
      ts: Number(r.ts),
    }));
  }
}

function toVectorLiteral(v: readonly number[]): string {
  return `[${v.join(",")}]`;
}

function parseVectorLiteral(s: string): number[] {
  const trimmed = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  return trimmed === "" ? [] : trimmed.split(",").map((x) => Number(x));
}
