export interface LotSizeInput {
  equity: number;
  riskPct: number;
  stopDistancePips: number;
  pipValuePerLot: number;
  maxLotSize: number;
}

export function computeLotSize(input: LotSizeInput): number {
  const { equity, riskPct, stopDistancePips, pipValuePerLot, maxLotSize } = input;
  if (stopDistancePips <= 0) return 0;
  if (pipValuePerLot <= 0) return 0;
  const maxRisk = (riskPct / 100) * equity;
  const rawLot = maxRisk / (stopDistancePips * pipValuePerLot);
  const capped = Math.min(rawLot, maxLotSize);
  return Math.floor(capped * 100) / 100;
}
