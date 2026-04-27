import type { Position } from "@forex-bot/contracts";

export interface ReconcileInput {
  expected: readonly Position[];
  observed: readonly Position[];
  priceTolerance?: number;
}

export interface ReconcileResult {
  divergent: boolean;
  missing: readonly Position[];
  extra: readonly Position[];
  drifted: readonly { id: string; expected: Position; observed: Position }[];
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const tol = input.priceTolerance ?? 1e-6;
  const expectedById = new Map(input.expected.map((p) => [p.id, p]));
  const observedById = new Map(input.observed.map((p) => [p.id, p]));

  const missing: Position[] = [];
  const drifted: { id: string; expected: Position; observed: Position }[] = [];
  for (const [id, e] of expectedById) {
    const o = observedById.get(id);
    if (!o) {
      missing.push(e);
      continue;
    }
    if (
      Math.abs(e.entry - o.entry) > tol ||
      Math.abs(e.sl - o.sl) > tol ||
      Math.abs(e.tp - o.tp) > tol ||
      Math.abs(e.lotSize - o.lotSize) > tol ||
      e.side !== o.side ||
      e.symbol !== o.symbol
    ) {
      drifted.push({ id, expected: e, observed: o });
    }
  }
  const extra: Position[] = [];
  for (const [id, o] of observedById) {
    if (!expectedById.has(id)) extra.push(o);
  }
  const divergent = missing.length > 0 || extra.length > 0 || drifted.length > 0;
  return { divergent, missing, extra, drifted };
}
