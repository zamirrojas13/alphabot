# ═══════════════════════════════════════════════════════════════════
# Indicators used by the 11 pilot strategies.
# Only what's actually needed: RSI, EMA50, EMA200, ATR, body/wick metrics,
# volume ratio, rolling hi/lo. NO Williams %R, NO chandelier.
# ═══════════════════════════════════════════════════════════════════
import numpy as np
import pandas as pd
from . import config


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Adds all columns needed by strategy.detect()."""
    c, h, l, o, v = df["close"], df["high"], df["low"], df["open"], df["volume"]

    # True range and ATR
    tr = pd.concat([(h - l), (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    df["atr"] = tr.rolling(config.ATR_LEN).mean()

    # RSI (Wilder smoothing approximated by SMA — same as our backtest)
    delta = c.diff()
    up = delta.clip(lower=0).rolling(config.RSI_LEN).mean()
    dn = (-delta.clip(upper=0)).rolling(config.RSI_LEN).mean()
    rs = up / dn.replace(0, np.nan)
    df["rsi"] = 100 - 100 / (1 + rs)

    # EMAs
    df["ema21"]  = c.ewm(span=21, adjust=False).mean()
    df["ema50"]  = c.ewm(span=config.EMA_FAST, adjust=False).mean()
    df["ema200"] = c.ewm(span=config.EMA_SLOW, adjust=False).mean()

    # Candle anatomy
    rng = h - l
    df["range"]      = rng
    df["body"]       = (c - o).abs()
    df["body_ratio"] = df["body"] / rng.replace(0, np.nan)
    df["upper_wick"] = h - np.maximum(c, o)
    df["lower_wick"] = np.minimum(c, o) - l
    df["candle_dir"] = np.where(c > o, 1, np.where(c < o, -1, 0))

    # Volume
    df["vol_ma"]    = v.rolling(config.VOL_MA_LEN).mean()
    df["vol_ratio"] = v / df["vol_ma"].replace(0, np.nan)

    # Rolling extremes — shifted by 1 so current bar is excluded.
    # This makes hi20 = max of PRIOR 20 bars, enabling the sweep-above-hi20 pattern
    # (cur["high"] > cur["hi20"]) which was impossible when hi20 included the current bar.
    df["hi20"] = h.rolling(config.HI_LO_LEN).max().shift(1)
    df["lo20"] = l.rolling(config.HI_LO_LEN).min().shift(1)

    # Distance from EMA200
    df["dist_ema200_pct"] = (c - df["ema200"]) / df["ema200"] * 100

    # Direction relative to EMA200 (used by some strats)
    df["above_ema200"] = c > df["ema200"]
    df["below_ema200"] = c < df["ema200"]

    # Williams %R — used by T1f Willy Exhaustion Short
    for period, col in [(14, "wpr_fast"), (28, "wpr_slow")]:
        hh = h.rolling(period).max()
        ll = l.rolling(period).min()
        df[col] = -100 * (hh - c) / (hh - ll).replace(0, np.nan)

    return df
