export const CB_BANKS = ["FED", "ECB", "BOE", "BOJ", "SNB", "RBA", "RBNZ"] as const;
export type CbBank = (typeof CB_BANKS)[number];
