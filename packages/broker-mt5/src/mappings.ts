import type { Side, Timeframe } from "@forex-bot/contracts";
import { Side as ProtoSide, Timeframe as ProtoTimeframe } from "./generated/mt5.js";

export function tfToProto(tf: Timeframe): ProtoTimeframe {
  switch (tf) {
    case "M1":
      return ProtoTimeframe.TIMEFRAME_M1;
    case "M5":
      return ProtoTimeframe.TIMEFRAME_M5;
    case "M15":
      return ProtoTimeframe.TIMEFRAME_M15;
    case "M30":
      return ProtoTimeframe.TIMEFRAME_M30;
    case "H1":
      return ProtoTimeframe.TIMEFRAME_H1;
    case "H4":
      return ProtoTimeframe.TIMEFRAME_H4;
    case "D1":
      return ProtoTimeframe.TIMEFRAME_D1;
    case "W1":
      return ProtoTimeframe.TIMEFRAME_W1;
  }
}

export function sideToProto(s: Side): ProtoSide {
  return s === "buy" ? ProtoSide.SIDE_BUY : ProtoSide.SIDE_SELL;
}

export function sideFromProto(p: ProtoSide): Side {
  return p === ProtoSide.SIDE_BUY ? "buy" : "sell";
}
