import { describe, expect, it } from "vitest";
import { clusterLevels } from "../src/support-resistance.js";

describe("support-resistance clusterLevels", () => {
  it("clusters close levels within tolerance", () => {
    // Sorted: [1.0805, 1.081, 1.0815, 1.095, 1.0955]. Tolerance 0.0015.
    // Head-to-current distance: 0.0005, 0.001, 0.0145, 0.0005 → cluster 1 has 3 items, cluster 2 has 2.
    const clusters = clusterLevels([1.0805, 1.081, 1.0815, 1.095, 1.0955], 0.0015);
    expect(clusters).toEqual([
      { price: expect.closeTo(1.081, 5), touches: 3 },
      { price: expect.closeTo(1.09525, 5), touches: 2 },
    ]);
  });

  it("empty input → empty output", () => {
    expect(clusterLevels([], 0.001)).toEqual([]);
  });
});
