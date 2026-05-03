/**
 * Mulberry32 — a small, fast, seedable 32-bit PRNG.
 *
 * Produces uniformly distributed numbers in [0, 1). Deterministic for a given
 * seed: the same seed always yields the same sequence, which is essential for
 * reproducible backtests / evals.
 */
export class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns the next pseudo-random number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
