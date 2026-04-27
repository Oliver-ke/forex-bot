"""Static mappings between proto enums and MT5 SDK constants.

The MT5 SDK numeric values are intentionally hard-coded here so the module is
importable without the `MetaTrader5` package (CI runs without it).
"""

from __future__ import annotations

# MT5 SDK constants. See https://www.mql5.com/en/docs/integration/python_metatrader5
MT5_TIMEFRAME_M1 = 1
MT5_TIMEFRAME_M5 = 5
MT5_TIMEFRAME_M15 = 15
MT5_TIMEFRAME_M30 = 30
MT5_TIMEFRAME_H1 = 16385
MT5_TIMEFRAME_H4 = 16388
MT5_TIMEFRAME_D1 = 16408
MT5_TIMEFRAME_W1 = 32769

PROTO_TO_MT5_TIMEFRAME = {
    1: MT5_TIMEFRAME_M1,
    5: MT5_TIMEFRAME_M5,
    15: MT5_TIMEFRAME_M15,
    30: MT5_TIMEFRAME_M30,
    60: MT5_TIMEFRAME_H1,
    240: MT5_TIMEFRAME_H4,
    1440: MT5_TIMEFRAME_D1,
    10080: MT5_TIMEFRAME_W1,
}

MT5_ORDER_TYPE_BUY = 0
MT5_ORDER_TYPE_SELL = 1
MT5_ORDER_TYPE_BUY_LIMIT = 2
MT5_ORDER_TYPE_SELL_LIMIT = 3
MT5_ORDER_TYPE_BUY_STOP = 4
MT5_ORDER_TYPE_SELL_STOP = 5

MT5_TRADE_ACTION_DEAL = 1
MT5_TRADE_ACTION_PENDING = 5

MT5_TRADE_RETCODE_DONE = 10009
