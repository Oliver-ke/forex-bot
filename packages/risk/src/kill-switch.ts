export interface KillSwitchState {
  tripped: boolean;
  reason?: string;
  trippedAt?: number;
}

export interface KillSwitchObservation {
  dailyPnlPct: number;
  totalDdPct: number;
  consecutiveLosses: number;
  lastFeedAgeSec: number;
}

export interface KillSwitchThresholds {
  maxDailyLossPct: number;
  maxTotalDrawdownPct: number;
  maxConsecutiveLosses: number;
  feedStaleSec: number;
}

export class KillSwitch {
  private s: KillSwitchState;

  constructor(initial: KillSwitchState = { tripped: false }) {
    this.s = { ...initial };
  }

  state(): KillSwitchState {
    return { ...this.s };
  }

  reset(): void {
    this.s = { tripped: false };
  }

  observe(obs: KillSwitchObservation, t: KillSwitchThresholds, now = Date.now()): void {
    if (this.s.tripped) return;
    if (obs.dailyPnlPct <= -t.maxDailyLossPct) return this.trip("daily loss cap exceeded", now);
    if (obs.totalDdPct <= -t.maxTotalDrawdownPct)
      return this.trip("total drawdown cap exceeded", now);
    if (obs.consecutiveLosses >= t.maxConsecutiveLosses)
      return this.trip("consecutive losses exceeded", now);
    if (obs.lastFeedAgeSec >= t.feedStaleSec) return this.trip("feed stale", now);
  }

  tripManual(reason: string, now = Date.now()): void {
    this.trip(`manual: ${reason}`, now);
  }

  private trip(reason: string, now: number): void {
    this.s = { tripped: true, reason, trippedAt: now };
  }
}
