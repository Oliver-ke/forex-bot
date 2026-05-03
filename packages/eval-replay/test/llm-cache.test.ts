import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmCache } from "../src/llm-cache.js";

describe("LlmCache", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "llm-cache-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a value via set/get", async () => {
    const cache = new LlmCache(dir);
    await cache.set("k", { hello: "world" });
    const got = await cache.get<{ hello: string }>("k");
    expect(got).toEqual({ hello: "world" });
  });

  it("returns undefined on miss", async () => {
    const cache = new LlmCache(dir);
    const got = await cache.get("absent");
    expect(got).toBeUndefined();
  });

  it("produces different keys for different user text", () => {
    const cache = new LlmCache(dir);
    const a = cache.makeKey({ model: "m", system: "s", user: "a", schema: { _def: {} } });
    const b = cache.makeKey({ model: "m", system: "s", user: "b", schema: { _def: {} } });
    expect(a).not.toBe(b);
  });

  it("produces a stable key across calls with identical inputs", () => {
    const cache = new LlmCache(dir);
    const a = cache.makeKey({ model: "m", system: "s", user: "u", schema: { _def: { x: 1 } } });
    const b = cache.makeKey({ model: "m", system: "s", user: "u", schema: { _def: { x: 1 } } });
    expect(a).toBe(b);
  });

  it("throws an Error including the file path on corrupted JSON", async () => {
    const cache = new LlmCache(dir);
    const badPath = join(dir, "bad.json");
    await writeFile(badPath, "{not valid json", "utf8");
    await expect(cache.get("bad")).rejects.toThrow(badPath);
  });
});
