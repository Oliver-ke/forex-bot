export interface Level {
  price: number;
  touches: number;
}

export function clusterLevels(prices: readonly number[], tolerance: number): Level[] {
  if (tolerance <= 0) throw new Error("tolerance must be > 0");
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const out: Level[] = [];
  let bucket: number[] = [sorted[0] as number];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i] as number;
    const head = bucket[0] as number;
    if (cur - head <= tolerance) {
      bucket.push(cur);
    } else {
      out.push(avgLevel(bucket));
      bucket = [cur];
    }
  }
  out.push(avgLevel(bucket));
  return out;
}

function avgLevel(bucket: readonly number[]): Level {
  const sum = bucket.reduce((a, b) => a + b, 0);
  return { price: sum / bucket.length, touches: bucket.length };
}
