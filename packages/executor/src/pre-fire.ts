import type { PreFireInput } from "./types.js";

export interface PreFireResult {
  pass: boolean;
  reason?: string;
}

export function preFire(input: PreFireInput): PreFireResult {
  const cap = input.medianSpreadPips * input.maxSpreadMultiplier;
  if (input.currentSpreadPips > cap) {
    return { pass: false, reason: `spread ${input.currentSpreadPips}p > cap ${cap.toFixed(2)}p` };
  }
  if (input.feedAgeSec >= input.maxFeedAgeSec) {
    return { pass: false, reason: `feed stale: ${input.feedAgeSec}s >= ${input.maxFeedAgeSec}s` };
  }
  const requiredCushion = input.estimatedRequiredMargin * 1.5;
  if (input.freeMargin < requiredCushion) {
    return {
      pass: false,
      reason: `margin: free ${input.freeMargin.toFixed(0)} < required×1.5 ${requiredCushion.toFixed(0)}`,
    };
  }
  return { pass: true };
}
