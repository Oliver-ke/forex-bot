import { describe, expect, it } from "vitest";
import { type Job, runDueJobs } from "../src/scheduler.js";

describe("scheduler.runDueJobs", () => {
  it("runs jobs whose due time has elapsed", async () => {
    const ran: string[] = [];
    const jobs: Job[] = [
      { id: "news", intervalSec: 300, lastRunAt: 1000, run: async () => void ran.push("news") },
      { id: "cal", intervalSec: 900, lastRunAt: 1000, run: async () => void ran.push("cal") },
    ];
    await runDueJobs(jobs, { nowMs: 1000 + 600 * 1000 });
    expect(ran).toEqual(["news"]);
  });

  it("updates lastRunAt for jobs that ran", async () => {
    const job: Job = { id: "x", intervalSec: 60, lastRunAt: 0, run: async () => {} };
    await runDueJobs([job], { nowMs: 60_000 });
    expect(job.lastRunAt).toBe(60_000);
  });

  it("aggregates errors but does not stop other jobs", async () => {
    const ran: string[] = [];
    const jobs: Job[] = [
      {
        id: "a",
        intervalSec: 1,
        lastRunAt: 0,
        run: async () => {
          throw new Error("boom");
        },
      },
      { id: "b", intervalSec: 1, lastRunAt: 0, run: async () => void ran.push("b") },
    ];
    const result = await runDueJobs(jobs, { nowMs: 60_000 });
    expect(ran).toEqual(["b"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.id).toBe("a");
  });
});
