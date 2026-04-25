import { describe, expect, it } from "vitest";
import { currencyExposureGate } from "../src/gates/currency-exposure.js";
import { mkGateCtx } from "./helpers/ctx.js";

describe("currencyExposureGate", () => {
  it("blocks when adding new trade pushes any currency over cap", () => {
    const r = currencyExposureGate(
      mkGateCtx({
        currencyExposurePct: { USD: 5.5, EUR: 2 },
        // new EURUSD adds 1% each side → USD becomes 6.5, cap is 6
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/USD/);
  });

  it("passes when exposures stay under cap", () => {
    const r = currencyExposureGate(
      mkGateCtx({ currencyExposurePct: { USD: 2, EUR: 1 } }),
    );
    expect(r.pass).toBe(true);
  });
});
