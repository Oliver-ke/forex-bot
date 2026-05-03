import { readFile } from "node:fs/promises";
import { type NewsHeadline, NewsHeadlineSchema } from "@forex-bot/contracts";

/**
 * Load a JSON array of news headlines and validate each element through
 * `NewsHeadlineSchema`. On any validation failure, the error message
 * includes the source file path.
 */
export async function loadHeadlines(path: string): Promise<readonly NewsHeadline[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`loadHeadlines: failed to read ${path}: ${stringifyError(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`loadHeadlines: invalid JSON at ${path}: ${stringifyError(err)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`loadHeadlines: expected an array at ${path}`);
  }

  const headlines: NewsHeadline[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = NewsHeadlineSchema.safeParse(parsed[i]);
    if (!result.success) {
      throw new Error(`loadHeadlines: invalid element ${i} in ${path}: ${result.error.message}`);
    }
    headlines.push(result.data);
  }

  return headlines;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
