/**
 * ReplayClock — a deterministic monotonic clock for replays / backtests.
 *
 * Time only moves forward. Attempting to rewind (via `advanceTo` to an earlier
 * timestamp, or `step` with a negative delta) throws — replays must never
 * time-travel.
 */
export class ReplayClock {
  private current: number;

  constructor(initialMs = 0) {
    this.current = initialMs;
  }

  /** Returns the current time in milliseconds. */
  now(): number {
    return this.current;
  }

  /** Jumps the clock to an absolute timestamp. Throws if `ms` is in the past. */
  advanceTo(ms: number): void {
    if (ms < this.current) {
      throw new Error(`ReplayClock cannot move backwards: now=${this.current}, advanceTo=${ms}`);
    }
    this.current = ms;
  }

  /** Advances the clock by `deltaMs`. Throws if `deltaMs` is negative. */
  step(deltaMs: number): void {
    if (deltaMs < 0) {
      throw new Error(`ReplayClock step must be >= 0, got ${deltaMs}`);
    }
    this.current += deltaMs;
  }
}
