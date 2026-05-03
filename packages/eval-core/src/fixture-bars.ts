import { readFile } from "node:fs/promises";
import { type Candle, CandleSchema, type Symbol } from "@forex-bot/contracts";
import { parse } from "csv-parse/sync";

/**
 * Load a CSV of OHLCV bars and validate each row through `CandleSchema`.
 *
 * The CSV must have header `ts,open,high,low,close,volume`. Numeric strings
 * are coerced to numbers via `cast: true`. After per-row schema validation,
 * the loader asserts strictly monotonic `ts` (each bar's `ts` greater than
 * the previous). On any validation failure, the error message includes the
 * source file path.
 *
 * The `symbol` parameter is part of the public signature for caller-side
 * correlation; it is NOT stored on the returned `Candle` (the schema has no
 * `symbol` field). It is included in error messages for diagnostics.
 */
export async function loadBars(path: string, symbol: Symbol): Promise<readonly Candle[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`loadBars: failed to read ${path} (symbol=${symbol}): ${stringifyError(err)}`);
  }

  let rows: unknown;
  try {
    rows = parse(raw, { columns: true, cast: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new Error(
      `loadBars: failed to parse CSV at ${path} (symbol=${symbol}): ${stringifyError(err)}`,
    );
  }

  if (!Array.isArray(rows)) {
    throw new Error(`loadBars: expected an array of rows from ${path} (symbol=${symbol})`);
  }

  const candles: Candle[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = CandleSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `loadBars: invalid row ${i} in ${path} (symbol=${symbol}): ${result.error.message}`,
      );
    }
    candles.push(result.data);
  }

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (!prev || !curr) {
      throw new Error(`loadBars: unexpected sparse array in ${path} (symbol=${symbol})`);
    }
    if (curr.ts <= prev.ts) {
      throw new Error(
        `loadBars: non-monotonic ts at row ${i} in ${path} (symbol=${symbol}): prev=${prev.ts}, curr=${curr.ts}`,
      );
    }
  }

  return candles;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
