import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RagDoc } from "@forex-bot/data-core";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgvectorRagStore } from "../src/pgvector-rag.js";

const PG_URL = process.env.PG_TEST_URL ?? "";
const __dirname = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!PG_URL)("PgvectorRagStore (integration)", () => {
  let client: Client;
  let store: PgvectorRagStore;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_URL });
    await client.connect();
    const sql = readFileSync(resolve(__dirname, "../migrations/001_rag_docs.sql"), "utf8");
    await client.query(sql);
    await client.query("TRUNCATE rag_docs");
    store = new PgvectorRagStore({ connectionString: PG_URL, dimension: 3 });
    await store.connect();
  });

  afterAll(async () => {
    await store.close();
    await client.end();
  });

  it("put + search returns top-k by cosine similarity", async () => {
    const docs: RagDoc[] = [
      {
        id: "a",
        text: "a",
        embedding: [1, 0, 0],
        modelVersion: "v1",
        metadata: { regime: "trending" },
        ts: 1,
      },
      {
        id: "b",
        text: "b",
        embedding: [0, 1, 0],
        modelVersion: "v1",
        metadata: { regime: "ranging" },
        ts: 2,
      },
      {
        id: "c",
        text: "c",
        embedding: [0.9, 0.1, 0],
        modelVersion: "v1",
        metadata: { regime: "trending" },
        ts: 3,
      },
    ];
    for (const d of docs) await store.put(d);
    const out = await store.search({ embedding: [1, 0, 0], k: 2 });
    expect(out.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("filters by metadata", async () => {
    const out = await store.search({ embedding: [1, 0, 0], k: 5, filter: { regime: "ranging" } });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });
});
