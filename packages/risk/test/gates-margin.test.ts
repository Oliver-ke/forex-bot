import { describe, expect, it } from "vitest";
import { marginGate } from "../src/gates/margin.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("marginGate", () => {
  it("blocks when expected used margin after trade exceeds free margin × 0.8", () => {
    const r = marginGate(
      mkGateCtx({
        account: { ...mkGateCtx().account, freeMargin: 100, usedMargin: 0 },
        order: { ...mkGateCtx().order, lotSize: 100 }, // huge
      }),
    );
    expect(r.pass).toBe(false);
  });

  it("passes on tiny order", () => {
    const r = marginGate(mkGateCtx({ order: { ...mkGateCtx().order, lotSize: 0.01 } }));
    expect(r.pass).toBe(true);
  });
});
