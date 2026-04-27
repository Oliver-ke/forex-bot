import { describe, expect, it } from "vitest";
import { initial, transition } from "../src/state-machine.js";

describe("order state machine", () => {
  it("starts in 'draft'", () => {
    const r = initial("o-1", 1);
    expect(r.state).toBe("draft");
    expect(r.history).toHaveLength(0);
  });

  it("draft → pre_fire_pass → submitting → submitted on submit_ack with no fill", () => {
    let r = initial("o-1", 1);
    r = transition(r, { kind: "validate" }, 2);
    r = transition(r, { kind: "pre_fire_pass" }, 3);
    r = transition(r, { kind: "submit" }, 4);
    r = transition(r, { kind: "submit_ack", ticket: "T1" }, 5);
    expect(r.state).toBe("submitted");
    expect(r.ticket).toBe("T1");
  });

  it("submitted → filled on submit_ack with fillPrice", () => {
    let r = initial("o-1", 1);
    r = transition(r, { kind: "validate" }, 2);
    r = transition(r, { kind: "pre_fire_pass" }, 3);
    r = transition(r, { kind: "submit" }, 4);
    r = transition(r, { kind: "submit_ack", ticket: "T1", fillPrice: 1.08 }, 5);
    expect(r.state).toBe("filled");
    expect(r.fillPrice).toBe(1.08);
  });

  it("pre_fire_fail → pre_fire_failed (terminal)", () => {
    let r = initial("o-1", 1);
    r = transition(r, { kind: "validate" }, 2);
    r = transition(r, { kind: "pre_fire_fail", reason: "spread too wide" }, 3);
    expect(r.state).toBe("pre_fire_failed");
    expect(r.rejectReason).toContain("spread");
  });

  it("submit_reject → rejected (terminal)", () => {
    let r = initial("o-1", 1);
    r = transition(r, { kind: "validate" }, 2);
    r = transition(r, { kind: "pre_fire_pass" }, 3);
    r = transition(r, { kind: "submit" }, 4);
    r = transition(r, { kind: "submit_reject", reason: "no liquidity" }, 5);
    expect(r.state).toBe("rejected");
    expect(r.rejectReason).toContain("liquidity");
  });

  it("filled → closed on close", () => {
    let r = initial("o-1", 1);
    r = transition(r, { kind: "validate" }, 2);
    r = transition(r, { kind: "pre_fire_pass" }, 3);
    r = transition(r, { kind: "submit" }, 4);
    r = transition(r, { kind: "submit_ack", ticket: "T1", fillPrice: 1.08 }, 5);
    r = transition(r, { kind: "close", reason: "tp" }, 6);
    expect(r.state).toBe("closed");
  });

  it("rejects illegal transition", () => {
    const r = initial("o-1", 1);
    // submit_ack from draft is illegal: nothing was submitted yet.
    expect(() => transition(r, { kind: "submit_ack", ticket: "T1" }, 2)).toThrow(/illegal/i);
  });
});
