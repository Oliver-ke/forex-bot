import type { Symbol } from "@forex-bot/contracts";

/**
 * Returns the pip value (in USD) for a standard lot (100,000 units).
 *
 * - JPY pairs: 1 pip = 0.01 price units; pip value ≈ 1000 / quoteToUsd
 * - All other pairs: pip value = $10 per standard lot
 *
 * @param symbol      - The 6-char currency-pair symbol (e.g. "EURUSD", "USDJPY")
 * @param quoteToUsd  - USD value of 1 unit of the quote currency (JPY only).
 *                      Defaults to 150 (≈ current USD/JPY rate).
 */
export function pipValuePerLot(symbol: Symbol, quoteToUsd?: number): number {
  if (symbol.endsWith("JPY")) {
    return 1000 / (quoteToUsd ?? 150);
  }
  return 10;
}
