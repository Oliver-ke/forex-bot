import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface KeyInput {
  model: string;
  system: string;
  user: string;
  schema: { _def: unknown };
}

/**
 * File-backed cache for structured LLM responses.
 *
 * Pure storage: no LLM provider dependency. Files live at
 * `<dir>/<key>.json` and are pretty-printed for diffability.
 * The directory is created lazily on first `set`.
 */
export class LlmCache {
  constructor(private readonly dir: string) {}

  /**
   * Compute a stable cache key from `(model, system, user, schemaShape)`.
   *
   * `schemaShape` is `JSON.stringify(req.schema._def)` so that semantically
   * different Zod schemas (different shapes) produce different keys without
   * dragging in any Zod runtime dependency. The digest is sha256, hex,
   * truncated to 32 chars (128 bits) which is still cryptographically safe
   * for cache addressing.
   */
  makeKey(req: KeyInput): string {
    const canonical = JSON.stringify({
      model: req.model,
      system: req.system,
      user: req.user,
      schemaShape: JSON.stringify(req.schema._def),
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  }

  /** Returns the cached response or `undefined` if not found. */
  async get<T>(key: string): Promise<T | undefined> {
    const path = this.pathFor(key);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if (isEnoent(err)) return undefined;
      throw err;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new Error(`LlmCache: malformed JSON at ${path}: ${stringifyError(err)}`);
    }
  }

  /** Writes the response to disk under `key`, creating the dir if needed. */
  async set<T>(key: string, value: T): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.pathFor(key);
    await writeFile(path, JSON.stringify(value, null, 2), "utf8");
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}.json`);
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
