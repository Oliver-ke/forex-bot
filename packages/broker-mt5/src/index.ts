export * from "./adapter.js";
export * from "./client.js";
export * from "./mappings.js";
// Re-export proto types/services so consumers (e.g. test fakes) don't need
// to depend on the generated path directly.
export {
  MT5Service,
  OrderType,
  Side,
  Timeframe as ProtoTimeframe,
} from "./generated/mt5.js";
