import type { LlmProvider, StructuredRequest } from "@forex-bot/llm-provider";
import type { LlmCache } from "./llm-cache.js";

export type CachedLlmMode = "replay-only" | "record";

export interface CachedLlmOpts {
  /** Used only on cache miss in `"record"` mode. */
  upstream: LlmProvider;
  cache: LlmCache;
  /** Default for cheap-mode replay is `"replay-only"`. */
  mode: CachedLlmMode;
}

/**
 * `LlmProvider` wrapper that serves responses from `LlmCache`.
 *
 * - `"replay-only"`: every miss is a hard error. Used in CI / cheap replay
 *   so we never silently rack up real LLM spend.
 * - `"record"`: misses fall through to `upstream` and write back to disk,
 *   so a subsequent run can replay from cache.
 *
 * Cached values are revalidated against `req.schema` on each hit so a stale
 * fixture (schema drift, hand-edit) fails fast instead of poisoning a run.
 */
export class CachedLlm implements LlmProvider {
  readonly stats: { hits: number; misses: number } = { hits: 0, misses: 0 };
  private readonly upstream: LlmProvider;
  private readonly cache: LlmCache;
  private readonly mode: CachedLlmMode;

  constructor(opts: CachedLlmOpts) {
    this.upstream = opts.upstream;
    this.cache = opts.cache;
    this.mode = opts.mode;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const key = this.cache.makeKey(req);
    const cached = await this.cache.get<unknown>(key);

    if (cached !== undefined) {
      const parsed = req.schema.safeParse(cached);
      if (!parsed.success) {
        throw new Error(
          `cached LLM response for key ${key} failed schema: ${parsed.error.message}`,
        );
      }
      this.stats.hits += 1;
      return parsed.data;
    }

    this.stats.misses += 1;
    if (this.mode === "replay-only") {
      throw new Error(`LLM cache miss in replay-only mode: model=${req.model} key=${key}`);
    }

    const fresh = await this.upstream.structured(req);
    await this.cache.set(key, fresh);
    return fresh;
  }
}
