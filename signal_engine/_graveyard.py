"""
Retired strategies — not active, preserved for reference.
These detectors were removed from scan_all() after backtest confirmed no edge.
This file is NOT imported anywhere in production code.
"""
import pandas as pd
import numpy as np
from . import config
from .strategy import _build_signal


# ── Willy %R 3-step helper (only used by retired strategies) ───────────────

def _willy_fired(df_h4, direction: str) -> bool:
    """True if the Willy 3-step signal fires on the very last H4 bar."""
    wf = df_h4["wpr_fast"].values
    ws = df_h4["wpr_slow"].values
    n  = len(df_h4)
    armed = stepped = False
    for i in range(1, n):
        if direction == "long":
            if wf[i] <= -75 and ws[i] <= -75:              armed = True;  stepped = False
            if armed and not stepped and wf[i] > -75  and wf[i-1] <= -75: stepped = True
            if armed and stepped     and ws[i] > -75  and ws[i-1] <= -75:
                if i == n - 1: return True
                armed = stepped = False
        else:
            if wf[i] >= -25 and ws[i] >= -25:              armed = True;  stepped = False
            if armed and not stepped and wf[i] < -25  and wf[i-1] >= -25: stepped = True
            if armed and stepped     and ws[i] < -25  and ws[i-1] >= -25:
                if i == n - 1: return True
                armed = stepped = False
    return False


# ── T1e — Weekly oversold hammer (retired) ─────────────────────────────────
# 25% WR, -0.39R avg over 8 years. Poor edge confirmed by backtest.

def detect_T1e(df_w):
    if len(df_w) < 1: return None
    cur = df_w.iloc[-1]
    if (cur["rsi"] < 35 and cur["close"] > cur["ema200"]
        and cur["lower_wick"] > 1.5 * cur["body"]
        and cur["close"] > cur["open"]):
        return _build_signal("T1e_W_oversold_hammer_long", cur["close"], "long", 0.08, 2.5,
                              f"Weekly hammer in uptrend. RSI {cur['rsi']:.0f}.")
    return None


# ── T2c — Weekly bull engulf (retired) ─────────────────────────────────────
# 0% WR, -0.69R avg over 8 years. Dead signal confirmed by backtest.

def detect_T2c(df_w):
    if len(df_w) < 3: return None
    setup = df_w.iloc[-2]
    conf  = df_w.iloc[-1]
    bull_engulf = (setup["close"] > setup["open"]
                   and df_w.iloc[-3]["close"] < df_w.iloc[-3]["open"]
                   and setup["close"] >= df_w.iloc[-3]["open"]
                   and setup["open"]  <= df_w.iloc[-3]["close"])
    if (bull_engulf and setup["close"] > setup["ema200"]
        and conf["close"] > setup["high"]):
        return _build_signal("T2c_W_bull_engulf_long", conf["close"], "long", 0.06, 3.0,
                              f"Weekly bull engulf + close > setup high.")
    return None


# ── T2a — Daily hammer at low (retired) ────────────────────────────────────
# 25% WR, -0.15R avg. Hammer pattern unreliable without trend filter.

def detect_T2a(df_d, df_w):
    if len(df_d) < 21: return None
    cur = df_d.iloc[-1]
    if pd.isna(cur["lo20"]) or pd.isna(cur["vol_ratio"]): return None
    if (cur["lower_wick"] > 2.0 * cur["body"]
        and cur["body_ratio"] < 0.4
        and cur["low"] <= cur["lo20"]
        and cur["rsi"] < 40
        and cur["vol_ratio"] >= 1.2):
        wkly = df_w.iloc[-1]
        if wkly["rsi"] > 50:
            return _build_signal("T2a_D_hammer_long", cur["close"], "long", 0.05, 2.5,
                                  f"Daily hammer at 20d low. RSI {cur['rsi']:.0f}, weekly RSI {wkly['rsi']:.0f}.")
    return None


# ── T3b — H4 sweep-high loose (retired) ────────────────────────────────────
# SL too tight (1.5%) for fee drag. 34% WR, -0.07R net.

def detect_T3b(df_h4, df_d=None, df_w=None):
    if len(df_h4) < 21: return None
    cur = df_h4.iloc[-1]
    if pd.isna(cur.get("hi20")) or pd.isna(cur.get("vol_ratio")): return None
    if not (cur["high"] > cur["hi20"]
            and cur["close"] < cur["hi20"]
            and (cur["high"] - cur["close"]) > 0.5 * cur["range"]
            and cur.get("below_ema200", False)
            and cur["rsi"] > 56
            and cur["vol_ratio"] >= 1.1):
        return None
    return _build_signal("T3b_H4_sweep_hi_short_loose", cur["close"], "short", 0.015, 2.5,
                          f"H4 sweep & reject. RSI {cur['rsi']:.0f}, vol {cur['vol_ratio']:.1f}x.")


# ── T1f — H4 Willy exhaustion short (retired) ──────────────────────────────
# 32.6% WR, -0.10R avg. F&G gate not sufficient to save it.

def detect_T1f(df_h4, df_d, df_w):
    if len(df_h4) < 50 or len(df_d) < 2 or len(df_w) < 2: return None
    d = df_d.iloc[-1]; w = df_w.iloc[-1]
    d_gap = (d["ema50"] - d["ema200"]) / d["ema200"] * 100
    w_gap = (w["close"] - w["ema200"]) / w["ema200"] * 100
    if not (d_gap < -1.0 and w_gap < -2.0): return None
    fg = float(d.get("fg_fear_greed", 50))
    if fg < 20: return None
    OB = -25
    wf = df_h4["wpr_fast"].values
    ws = df_h4["wpr_slow"].values
    n  = len(df_h4)
    start = max(1, n - 60)
    armed, yel_exited, signal_now = False, False, False
    for i in range(start, n):
        if wf[i] >= OB and ws[i] >= OB:
            armed = True; yel_exited = False
        if armed and not yel_exited and wf[i-1] >= OB and wf[i] < OB:
            yel_exited = True
        if armed and yel_exited and ws[i-1] >= OB and ws[i] < OB:
            if i == n - 1: signal_now = True
            armed = False; yel_exited = False
    if not signal_now: return None
    cur = df_h4.iloc[-1]
    lo50 = df_h4["low"].iloc[-50:].min()
    if cur["close"] < lo50 * 1.03: return None
    swing_hi = df_h4["high"].iloc[-10:].max()
    sl_pct = round(max(min((swing_hi * 1.005 - cur["close"]) / cur["close"], 0.05), 0.015), 4)
    return _build_signal("T1f_H4_willy_rev_short", cur["close"], "short", sl_pct, 3.0,
                          f"H4 Willy 3-step short. Daily EMA gap {d_gap:.1f}%, Weekly {w_gap:.1f}% below EMA200.")


# ── T2f — H4 RSI bearish divergence (retired) ──────────────────────────────
# 32% WR, -0.06R avg over 8 years. Divergence not reliable enough.

def detect_T2f(df_h4):
    if len(df_h4) < 22: return None
    cur = df_h4.iloc[-1]
    if pd.isna(cur.get("vol_ratio")): return None
    hi20 = df_h4["high"].iloc[-21:-1].max()
    rsi_max20 = df_h4["rsi"].iloc[-21:-1].max()
    if pd.isna(rsi_max20): return None
    if not (cur["high"] >= hi20
            and cur["rsi"] < rsi_max20 - 5
            and cur.get("below_ema200", not cur.get("above_ema200", True))
            and cur["rsi"] > 55
            and cur["close"] < cur["open"]
            and cur["vol_ratio"] >= 1.2):
        return None
    swing_hi = df_h4["high"].iloc[-10:].max()
    sl_pct = round(max(min((swing_hi * 1.005 - cur["close"]) / cur["close"], 0.05), 0.015), 4)
    return _build_signal("T2f_H4_rsi_bear_div_short", cur["close"], "short", sl_pct, 2.4,
                          f"H4 RSI bearish divergence at {cur['high']:,.0f}. RSI {cur['rsi']:.0f} vs max {rsi_max20:.0f}.")


# ── T1g — H4 volume surge long (retired) ───────────────────────────────────
# 32% WR, -0.23R avg. Long vol surges confirmed losing over 8yr.

def detect_T1g(df_h4, df_d, df_w):
    if len(df_h4) < 60 or len(df_d) < 2 or len(df_w) < 2: return None
    cur = df_h4.iloc[-1]
    if pd.isna(cur.get("vol_ratio")) or pd.isna(cur.get("atr")): return None
    if cur["vol_ratio"] < 2.0: return None
    if cur["rsi"] > 38: return None
    d = df_d.iloc[-1]; w = df_w.iloc[-1]
    d_gap = (d["ema21"] - d["ema50"]) / d["ema50"]
    w_gap = (w["close"] - w["ema50"])  / w["ema50"]
    if d_gap <= 0.01 or w_gap <= 0.02: return None
    if not _willy_fired(df_h4, "long"): return None
    swing_lo = df_h4["low"].iloc[-10:].min()
    sl_pct   = round(max(min((cur["close"] - swing_lo * 0.995) / cur["close"], 0.06), 0.015), 4)
    return _build_signal("T1g_H4_vol_surge_long", cur["close"], "long", sl_pct, 3.0,
                          f"H4 vol surge {cur['vol_ratio']:.1f}x + Willy long. "
                          f"Daily {d_gap*100:.1f}%, weekly {w_gap*100:.1f}%.")


# ── T1h — H4 volume surge short (retired) ──────────────────────────────────
# 38% WR, -0.23R avg. Still losing after RSI tightening.

def detect_T1h(df_h4, df_d, df_w):
    if len(df_h4) < 60 or len(df_d) < 2 or len(df_w) < 2: return None
    cur = df_h4.iloc[-1]
    if pd.isna(cur.get("vol_ratio")) or pd.isna(cur.get("atr")): return None
    if cur["vol_ratio"] < 2.0: return None
    if cur["rsi"] < 65: return None
    d = df_d.iloc[-1]; w = df_w.iloc[-1]
    d_gap = (d["ema21"] - d["ema50"]) / d["ema50"]
    w_gap = (w["close"] - w["ema50"])  / w["ema50"]
    if d_gap > 0.01 or w_gap >= 0: return None
    if not _willy_fired(df_h4, "short"): return None
    swing_hi = df_h4["high"].iloc[-10:].max()
    sl_pct   = round(max(min((swing_hi * 1.005 - cur["close"]) / cur["close"], 0.06), 0.015), 4)
    return _build_signal("T1h_H4_vol_surge_short", cur["close"], "short", sl_pct, 3.0,
                          f"H4 vol surge {cur['vol_ratio']:.1f}x + Willy short. "
                          f"Daily {d_gap*100:.1f}%, weekly {w_gap*100:.1f}%.")
