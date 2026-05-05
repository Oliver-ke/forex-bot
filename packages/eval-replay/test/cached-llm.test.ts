import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm, type LlmProvider, type StructuredRequest } from "@forex-bot/llm-provider";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CachedLlm } from "../src/cached-llm.js";
import { LlmCache } from "../src/llm-cache.js";

const schema = z.object({ answer: z.string() });

function makeReq(
  overrides: Partial<StructuredRequest<{ answer: string }>> = {},
): StructuredRequest<{
  answer: string;
}> {
  return {
    model: "claude-test-1",
    system: "you are a test",
    user: "hello",
    schema,
    ...overrides,
  };
}

describe("CachedLlm", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cached-llm-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns cached value without calling upstream on hit", async () => {
    const cache = new LlmCache(dir);
    const req = makeReq();
    const key = cache.makeKey(req);
    await cache.set(key, { answer: "from cache" });

    const upstream: LlmProvider = {
      structured: async () => {
        throw new Error("upstream called!");
      },
    };

    const cached = new CachedLlm({ upstream, cache, mode: "replay-only" });
    const got = await cached.structured(req);
    expect(got).toEqual({ answer: "from cache" });
    expect(cached.stats).toEqual({ hits: 1, misses: 0 });
  });

  it("throws on miss in replay-only mode with model in message", async () => {
    const cache = new LlmCache(dir);
    const req = makeReq({ model: "claude-replay-only-x" });
    const upstream: LlmProvider = {
      structured: async () => {
        throw new Error("upstream called!");
      },
    };
    const cached = new CachedLlm({ upstream, cache, mode: "replay-only" });
    await expect(cached.structured(req)).rejects.toThrow(/claude-replay-only-x/);
    expect(cached.stats).toEqual({ hits: 0, misses: 1 });
  });

  it("writes through to cache on miss in record mode", async () => {
    const cache = new LlmCache(dir);
    const req = makeReq();
    const upstream = new FakeLlm({ route: () => ({ answer: "from upstream" }) });

    const cached = new CachedLlm({ upstream, cache, mode: "record" });
    const got = await cached.structured(req);
    expect(got).toEqual({ answer: "from upstream" });
    expect(cached.stats).toEqual({ hits: 0, misses: 1 });

    // Verify the cache was written by reading it back via a fresh LlmCache.
    const fresh = new LlmCache(dir);
    const key = fresh.makeKey(req);
    const persisted = await fresh.get<{ answer: string }>(key);
    expect(persisted).toEqual({ answer: "from upstream" });
  });

  it("throws when cached value fails schema validation, including key in message", async () => {
    const cache = new LlmCache(dir);
    const req = makeReq();
    const key = cache.makeKey(req);
    // Stale shape: missing `answer`, has wrong field.
    await cache.set(key, { wrong: 42 });

    const upstream: LlmProvider = {
      structured: async () => {
        throw new Error("upstream called!");
      },
    };

    const cached = new CachedLlm({ upstream, cache, mode: "replay-only" });
    await expect(cached.structured(req)).rejects.toThrow(new RegExp(key));
  });
});
