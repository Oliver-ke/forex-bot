export interface Job {
  id: string;
  intervalSec: number;
  /** unix ms; mutated when the job runs (success or failure) */
  lastRunAt: number;
  run(now: number): Promise<void>;
}

export interface RunDueJobsResult {
  ran: readonly string[];
  errors: readonly { id: string; error: Error }[];
}

export async function runDueJobs(
  jobs: readonly Job[],
  opts: { nowMs: number },
): Promise<RunDueJobsResult> {
  const ran: string[] = [];
  const errors: { id: string; error: Error }[] = [];
  for (const j of jobs) {
    if (opts.nowMs - j.lastRunAt < j.intervalSec * 1000) continue;
    try {
      await j.run(opts.nowMs);
      ran.push(j.id);
    } catch (e) {
      errors.push({ id: j.id, error: e instanceof Error ? e : new Error(String(e)) });
    } finally {
      j.lastRunAt = opts.nowMs;
    }
  }
  return { ran, errors };
}
