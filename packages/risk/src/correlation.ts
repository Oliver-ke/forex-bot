import type { Position, Symbol } from "@forex-bot/contracts";

export type CorrelationEntry = Record<Symbol, number>;

export class CorrelationMatrix {
  constructor(private readonly data: Record<Symbol, CorrelationEntry>) {}

  corr(a: Symbol, b: Symbol): number {
    if (a === b) return 1;
    return this.data[a]?.[b] ?? 0;
  }
}

export interface NetRiskInput {
  matrix: CorrelationMatrix;
  newSymbol: Symbol;
  newSide: "buy" | "sell";
  newRiskPct: number;
  openPositions: readonly Position[];
  positionRiskPct: (p: Position) => number;
  threshold: number;
}

export function netCorrelatedRiskPct(input: NetRiskInput): number {
  const { matrix, newSymbol, newSide, newRiskPct, openPositions, positionRiskPct, threshold } = input;
  const newSign = newSide === "buy" ? 1 : -1;
  let net = newSign * newRiskPct;
  for (const p of openPositions) {
    const c = matrix.corr(newSymbol, p.symbol);
    if (Math.abs(c) < threshold) continue;
    const effectiveSign = (p.side === "buy" ? 1 : -1) * Math.sign(c);
    net += effectiveSign * positionRiskPct(p);
  }
  return Math.abs(net);
}
