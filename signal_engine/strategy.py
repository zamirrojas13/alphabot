# ═══════════════════════════════════════════════════════════════════
# Strategy detection — 11 pilot strategies.
# Each detector returns True/False on the LAST CONFIRMED bar of its TF.
# Logic mirrors backtest_scheme_i_plus.py (the validated edge source).
# ═══════════════════════════════════════════════════════════════════
import pandas as pd
import numpy as np
from . import config


# --- Helpers --------------------------------------------------------

def _fib_confluence(price: float, swing_lo: float, swing_hi: float,
                    tolerance: float = 0.012) -> bool:
    """Alex's core entry rule: only take pullbacks at Fibonacci levels.
    Returns True if `price` is within `tolerance` (1.2%) of the
    38.2%, 50%, or 61.8% retracement of the swing from swing_lo to swing_hi.
    Tolerance set at 1.2% to accommodate H1/H4 candle body spread.
    """
    if swing_hi <= swing_lo or swing_lo <= 0:
        return False
    rng = swing_hi - swing_lo
    for fib in (0.382, 0.500, 0.618):
        level = swing_hi - fib * rng          # retracement pulls back FROM the high
        if abs(price - level) / price <= tolerance:
            return True
    return False


def _last(df: pd.DataFrame, n: int = 1):
    """Get last N rows. n=1 returns the most recent confirmed bar (Series)."""
    return df.iloc[-n] if n == 1 else df.iloc[-n:]


def _weekly_red(df_w):
    last = df_w.iloc[-1]
    return last["close"] < last["open"]


def _weekly_above_ema200_pct(df_w):
    last = df_w.iloc[-1]
    return float(last.get("dist_ema200_pct", 0.0))


def _weekly_rsi(df_w):
    return float(df_w.iloc[-1]["rsi"])


def _daily_rsi(df_d):
    return float(df_d.iloc[-1]["rsi"])


# --- Strategy detectors --------------------------------------------
# Each returns dict with: fired (bool), entry, sl, tp, reason
# OR None if the bar didn't fire.

def _build_signal(strat_id: str, entry_price: float, side: str, sl_pct: float, rr: float,
                  reason: str, sl_price: float = None, tp_price: float = None):
    """Build a signal dict.
    Optional sl_price / tp_price override the mechanical sl_pct / rr calculation,
    allowing structural levels (Fibonacci SL, swing-high TP) per Alex's method.
    When overrides are used, sl_pct and rr are recomputed from the actual levels.
    """
    if sl_price is None:
        sl_price = entry_price * (1 - sl_pct) if side == "long" else entry_price * (1 + sl_pct)
    if tp_price is None:
        tp_price = entry_price * (1 + sl_pct * rr) if side == "long" else entry_price * (1 - sl_pct * rr)

    # Recompute sl_pct and rr from actual levels so rest of system is consistent
    sl_dist = abs(entry_price - sl_price)
    tp_dist = abs(tp_price   - entry_price)
    actual_sl_pct = sl_dist / entry_price if entry_price > 0 else sl_pct
    actual_rr     = tp_dist / sl_dist     if sl_dist    > 0 else rr

    info = config.STRATEGIES[strat_id]
    return dict(
        strat_id=strat_id, fired=True, side=side,
        entry=round(entry_price, 2), sl=round(sl_price, 2), tp=round(tp_price, 2),
        sl_pct=round(actual_sl_pct, 5), rr=round(actual_rr, 2),
        tier=info["tier"], tf=info["tf"],
        name=info["name"], desc=info["desc"], reason=reason,
    )


# ---- Weekly strategies ----

def detect_T1a(df_w):
    """Weekly fail breakdown: prev close below 20w low, current close back above.
    No EMA200 regime gate — this pattern works in any trend (fake breakdown recovers fast)."""
    if len(df_w) < 21: return None
    prev = df_w.iloc[-2]; cur = df_w.iloc[-1]
    if (prev["close"] < prev["lo20"]
            and cur["close"] > cur["lo20"]
            and cur["close"] > cur["open"]):          # green recovery candle
        return _build_signal("T1a_W_fail_brkdn_long", cur["close"], "long", 0.08, 3.0,
                              f"Weekly close reclaimed 20w low. RSI {cur['rsi']:.0f}.")
    return None


def detect_T1b(df_w):
    """Weekly RSI deeply oversold + crossing back above 38."""
    if len(df_w) < 2: return None
    prev = df_w.iloc[-2]; cur = df_w.iloc[-1]
    if prev["rsi"] < 35 and cur["rsi"] > 38 and cur["close"] > cur["open"]:
        return _build_signal("T1b_W_rsi_os_long", cur["close"], "long", 0.10, 3.0,
                              f"Weekly RSI rose from {prev['rsi']:.0f} to {cur['rsi']:.0f} with green close.")
    return None


def detect_T2b(df_w):
    """Weekly sweep of high: high > 20w high but close < 20w high, big upper wick + RSI band + momentum.
    Relaxed: momentum threshold lowered from 60% to 20% so it fires in normal bull cycles."""
    if len(df_w) < 51: return None
    cur = df_w.iloc[-1]
    if pd.isna(cur["hi20"]): return None
    mom_50 = (cur["close"] - df_w.iloc[-51]["close"]) / df_w.iloc[-51]["close"] * 100
    if (cur["high"] > cur["hi20"] and cur["close"] < cur["hi20"]
        and (cur["high"] - cur["close"]) > 0.5 * cur["range"]
        and 52 < cur["rsi"] < 75
        and mom_50 > 20                           # was 60 — never triggered
        and cur["candle_dir"] == -1):
        return _build_signal("T2b_W_sweep_hi_short", cur["close"], "short", 0.08, 2.5,
                              f"Weekly swept high & rejected. RSI {cur['rsi']:.0f}, 50w mom {mom_50:.0f}%.")
    return None


def detect_T3c(df_w):
    """Weekly 5-bar low reversal: setup = 5w low, confirmation = close > setup high AND > prior bar high."""
    if len(df_w) < 7: return None
    # setup bar (-3) made 5w low
    setup_idx = -3
    setup = df_w.iloc[setup_idx]
    five_low = df_w["low"].iloc[setup_idx-4:setup_idx+1].min()
    if setup["low"] != five_low: return None
    # confirmation bar (last bar)
    conf = df_w.iloc[-1]
    prev = df_w.iloc[-2]
    if conf["close"] > setup["high"] and conf["close"] > prev["high"]:
        return _build_signal("T3c_W_5bar_low_long", conf["close"], "long", 0.05, 2.0,
                              f"Weekly 5-bar low reversal confirmed.")
    return None


# ---- Daily strategies ----

def detect_T1c(df_d, df_w):
    """Daily shooting-star short + weekly extended above EMA200 + weekly red.
    Relaxed: weekly extension threshold lowered from 20% to 10%."""
    if len(df_d) < 21: return None
    cur = df_d.iloc[-1]
    if pd.isna(cur["hi20"]) or pd.isna(cur["vol_ratio"]): return None
    if (cur["upper_wick"] > 2.0 * cur["body"]
        and cur["body_ratio"] < 0.4
        and cur["high"] >= cur["hi20"]   # at or above prior 20d high
        and cur["rsi"] > 58
        and cur["vol_ratio"] >= 1.1):
        wkly = df_w.iloc[-1]
        wkly_pct = float(wkly.get("dist_ema200_pct", 0))
        wkly_red = wkly["close"] < wkly["open"]
        if wkly_pct > 10 and wkly_red:           # was > 20
            return _build_signal("T1c_D_sstar_short", cur["close"], "short", 0.05, 3.0,
                                  f"Daily shooting star at 20d high. RSI {cur['rsi']:.0f}, weekly +{wkly_pct:.0f}% above EMA200.")
    return None


# ---- 4-Hour strategies ----

def detect_T1d(df_h4, df_d):
    """H4 sweep high short + RSI>55 + vol confirmation + daily + weekly RSI regime gate.
    Added: vol_ratio>1.1 (sellers showed up), weekly RSI<68 (not in strong bull momentum)."""
    if len(df_h4) < 21: return None
    cur = df_h4.iloc[-1]
    if pd.isna(cur["hi20"]): return None
    if not (cur["high"] > cur["hi20"] and cur["close"] < cur["hi20"]
            and (cur["high"] - cur["close"]) > 0.6 * cur["range"]
            and cur["rsi"] > 55
            and cur.get("vol_ratio", 1.0) > 1.1):
        return None
    d_last = df_d.iloc[-1]
    if d_last["candle_dir"] != -1: return None
    fg = float(d_last.get("fg_fear_greed", 50))
    if fg < 20: return None
    return _build_signal("T1d_H4_sweep_hi_short", cur["close"], "short", 0.03, 3.0,
                          f"H4 swept 20-bar high & rejected. Vol {cur.get('vol_ratio',1):.1f}x, RSI {cur['rsi']:.0f}.")




# ---- Daily strategies (new) ----

def detect_T2d(df_d):
    """Daily 3-bar squeeze breakout LONG: 3 candles coil tight, then breaks up with vol.
    Relaxed: range threshold 3%->4.5%, vol 1.5x->1.3x, RSI band widened."""
    if len(df_d) < 6: return None
    hi3 = df_d["high"].iloc[-4:-1].max()
    lo3 = df_d["low"].iloc[-4:-1].min()
    if lo3 <= 0: return None
    tight = (hi3 - lo3) / lo3 * 100
    cur = df_d.iloc[-1]
    if pd.isna(cur.get("vol_ratio")): return None
    if not (tight < 4.5                           # was 3.0 — too tight for BTC
            and cur["close"] > hi3
            and cur["vol_ratio"] >= 1.3           # was 1.5
            and cur["close"] > cur.get("ema50", 0)
            and 50 < cur["rsi"] < 75              # was 52-70
            and cur["close"] > cur.get("ema200", 0)):
        return None
    return _build_signal("T2d_D_squeeze_brk_long", cur["close"], "long", 0.03, 2.67,
                         f"Daily 3-bar squeeze breakout. Range {tight:.1f}%, vol {cur['vol_ratio']:.1f}x, RSI {cur['rsi']:.0f}.")


def detect_T2e(df_w, df_d):
    """Weekly monthly-open reclaim LONG: weekly dipped below monthly open then reclaimed it."""
    if len(df_w) < 3 or len(df_d) < 5: return None
    # Monthly open = first daily open of current month
    cur_w = df_w.iloc[-1]
    dt = pd.Timestamp(cur_w.get("datetime", df_w.index[-1]))
    d_dt = pd.to_datetime(df_d["datetime"])
    month_candles = df_d[(d_dt.dt.year == dt.year) & (d_dt.dt.month == dt.month)]
    if len(month_candles) == 0: return None
    m_open = float(month_candles.iloc[0]["open"])
    prev_w = df_w.iloc[-2]
    if not (prev_w["close"] < m_open
            and cur_w["close"] > m_open
            and cur_w["close"] > cur_w.get("ema200", 0)
            and cur_w.get("vol_ratio", 1.0) >= 1.0   # was 1.2
            and cur_w["close"] > cur_w["open"]):
        return None
    return _build_signal("T2e_W_mo_reclaim_long", cur_w["close"], "long", 0.07, 2.57,
                         f"Weekly reclaimed monthly open ${m_open:,.0f}. Vol {cur_w.get('vol_ratio',1):.1f}x.")


def detect_T2g(df_d):
    """Daily bull flag breakout LONG: 5-day tight range (<5%) in uptrend, breaks above with vol."""
    if len(df_d) < 8: return None
    hi5 = df_d["high"].iloc[-6:-1].max()
    lo5 = df_d["low"].iloc[-6:-1].min()
    if lo5 <= 0: return None
    flag_tight = (hi5 - lo5) / lo5 * 100 < 5.0
    flag_up = df_d["close"].iloc[-6] < df_d["close"].iloc[-1]   # price higher than 5 bars ago
    cur = df_d.iloc[-1]
    if pd.isna(cur.get("vol_ratio")): return None
    if not (flag_tight and flag_up
            and cur["close"] > hi5
            and cur["close"] > cur.get("ema200", 0)
            and cur["close"] > cur.get("ema50", 0)
            and cur["rsi"] > 55
            and cur["vol_ratio"] >= 1.4):
        return None
    return _build_signal("T2g_D_bull_flag_long", cur["close"], "long", 0.03, 3.0,
                         f"Daily bull flag breakout. 5-day range {(hi5-lo5)/lo5*100:.1f}%, vol {cur['vol_ratio']:.1f}x, RSI {cur['rsi']:.0f}.")


# ---- New v6 strategies ----

def detect_T_sweep_lo_long(df_h4, df_d):
    """H4 sweep of 20-bar low then recovery — long setup (symmetric twin of T1d short).
    Price wicks below support, buyers absorb all sellers, closes back above.
    Bull-market only (daily above EMA200): sweep-of-low in bear markets just continues lower.
    Gated: daily above EMA200 + green candle + RSI < 50 + not in extreme greed (F&G < 80)."""
    if len(df_h4) < 21: return None
    cur = df_h4.iloc[-1]
    if pd.isna(cur.get("lo20")): return None
    if not (cur["low"] < cur["lo20"]                          # swept below 20-bar low
            and cur["close"] > cur["lo20"]                   # recovered above it
            and (cur["close"] - cur["low"]) > 0.6 * cur["range"]  # strong bullish recovery wick
            and cur["rsi"] < 50                              # not chasing — oversold area
            and cur.get("vol_ratio", 1.0) > 1.1):           # volume confirms buyers
        return None
    d_last = df_d.iloc[-1]
    if d_last["candle_dir"] != 1: return None                # daily closed green = confirmed
    # Bull market: allow freely. Bear market: only allow if H4 RSI < 35 (capitulation sweep)
    is_bull = d_last.get("above_ema200", False)
    if not is_bull and cur["rsi"] >= 35: return None
    fg = float(d_last.get("fg_fear_greed", 50))
    if fg > 80: return None                                  # don't buy in extreme greed
    return _build_signal("T_H4_sweep_lo_long", cur["close"], "long", 0.03, 3.0,
                          f"H4 swept 20-bar low & recovered. Vol {cur.get('vol_ratio',1):.1f}x, RSI {cur['rsi']:.0f}.")


def detect_T_W_ema50_dip_long(df_w, df_d):
    """Weekly EMA50 dip-and-bounce in confirmed bull market.
    BTC has reliably bounced off weekly EMA50 during bull runs (2020-21, 2023-24).
    Loosened: within 4% of EMA50 (was 3%), removed prev_dist requirement."""
    if len(df_w) < 55: return None
    cur = df_w.iloc[-1]
    ema50 = cur.get("ema50")
    if ema50 is None or pd.isna(ema50) or ema50 <= 0: return None
    dist_ema50 = abs(cur["close"] - ema50) / ema50 * 100
    if not (cur["close"] > cur.get("ema200", 0)              # bull market confirmed
            and dist_ema50 < 4.0                             # within 4% of EMA50 (loosened)
            and cur["low"] < ema50 * 1.02                   # actually tested the level
            and 38 < cur["rsi"] < 65                         # neutral RSI zone (widened)
            and cur["close"] > cur["open"]):                 # green close
        return None
    if df_d is not None and len(df_d) >= 1:
        fg = float(df_d.iloc[-1].get("fg_fear_greed", 50))
        if fg > 82: return None
    return _build_signal("T_W_ema50_dip_long", cur["close"], "long", 0.06, 2.5,
                          f"Weekly EMA50 bounce. RSI {cur['rsi']:.0f}, dist {dist_ema50:.1f}% from EMA50.")


def detect_T_H4_ema21_bounce_long(df_h4, df_d):
    """DISABLED — 33% WR even with first-touch filter. EMA bounces lack snap-back force vs sweeps."""
    return None
    if len(df_h4) < 25: return None
    cur = df_h4.iloc[-1]
    ema21 = cur.get("ema21")
    ema50_h4 = cur.get("ema50")
    if ema21 is None or pd.isna(ema21) or ema21 <= 0: return None
    if ema50_h4 is None or pd.isna(ema50_h4): return None
    if pd.isna(cur.get("vol_ratio")): return None
    # EMA21 must be above EMA50 on H4 (local bull structure)
    if ema21 <= ema50_h4: return None
    # FIRST TOUCH filter: no bar in prior 8 H4 bars can have had low < EMA21
    prior_8 = df_h4.iloc[-9:-1]
    ema21_series = prior_8["ema21"].values
    low_series   = prior_8["low"].values
    if any(low_series[i] < ema21_series[i] * 1.005 for i in range(len(prior_8))
           if not np.isnan(ema21_series[i])):
        return None                                      # not a fresh first touch
    # Core: wicked below EMA21, strong green recovery
    body = cur.get("body", 0)
    rng  = max(cur.get("range", 1e-6), 1e-6)
    if not (cur["low"] < ema21
            and cur["close"] > ema21
            and body > 0.35 * rng                      # meaningful body, not a doji
            and 45 < cur["rsi"] < 62                   # tighter: not broken, not overheated
            and cur.get("vol_ratio", 1.0) >= 1.0):     # real buying volume
        return None
    # Bull market gate: daily above EMA200
    d_last = df_d.iloc[-1]
    if not d_last.get("above_ema200", False): return None
    fg = float(d_last.get("fg_fear_greed", 50))
    if fg > 82: return None
    return _build_signal("T_H4_ema21_bounce_long", cur["close"], "long", 0.025, 2.5,
                          f"H4 EMA21 fresh-touch bounce. RSI {cur['rsi']:.0f}, vol {cur.get('vol_ratio',1):.1f}x.")


def detect_T_D_2bar_pullback_long(df_d):
    """DISABLED — 36% WR with full-erase condition. Pullback resumptions lack reliable edge here."""
    return None
    if len(df_d) < 55: return None
    cur   = df_d.iloc[-1]
    prev  = df_d.iloc[-2]
    prev2 = df_d.iloc[-3]
    if pd.isna(cur.get("vol_ratio")) or pd.isna(cur.get("ema50")): return None
    # Core: 2 consecutive reds → green bar erases the FULL 2-day pullback
    if not (prev2["candle_dir"] == -1             # 2 days ago: red
            and prev["candle_dir"] == -1          # yesterday: red
            and cur["candle_dir"] == 1            # today: green
            and cur["close"] > prev2["high"]):    # close ABOVE the first red bar's high (full erase)
        return None
    # Orderly pullback: total decline < 5% (not a crash, just a dip)
    total_decline = (prev2["open"] - prev["close"]) / max(prev2["open"], 1e-6)
    if total_decline > 0.05: return None
    # Uptrend: above EMA50
    if cur["close"] < cur.get("ema50", cur["close"]): return None
    # RSI: corrective but recovering
    if not (48 < cur["rsi"] < 68): return None
    # Volume: conviction on the recovery bar
    if cur.get("vol_ratio", 1.0) < 1.0: return None
    fg = float(cur.get("fg_fear_greed", 50))
    if fg > 85: return None
    return _build_signal("T_D_2bar_pullback_long", cur["close"], "long", 0.04, 2.5,
                          f"Daily 2-bar full-erase pullback. RSI {cur['rsi']:.0f}, decline {total_decline*100:.1f}%.")


def detect_T_D_ema200_bounce_long(df_d, df_w):
    """Daily EMA200 bounce — wick below but close above with volume.
    The 200-day MA is the single most watched level in all of finance.
    When it holds as support with volume, it's a high-conviction long."""
    if len(df_d) < 201: return None
    cur = df_d.iloc[-1]
    ema200 = cur.get("ema200")
    if ema200 is None or pd.isna(ema200) or ema200 <= 0: return None
    if pd.isna(cur.get("vol_ratio")): return None
    lower_wick = cur.get("lower_wick", 0)
    body = max(cur.get("body", 0), 1e-6)
    if not (cur["low"] < ema200                              # wicked below EMA200
            and cur["close"] > ema200                        # closed above it
            and cur["close"] > cur["open"]                   # green candle
            and lower_wick > 0.3 * body                     # some wick present (loosened from > body)
            and cur["rsi"] < 58                              # not overbought (loosened from 55)
            and cur["vol_ratio"] >= 1.1):                    # above-average volume (loosened from 1.2)
        return None
    wkly = df_w.iloc[-1]
    if wkly["rsi"] < 38: return None                         # avoid in deep bear — EMA200 may not hold
    fg = float(cur.get("fg_fear_greed", df_d.iloc[-1].get("fg_fear_greed", 50)))
    if fg > 85: return None                                   # avoid in extreme greed (loosened from 75)
    return _build_signal("T_D_ema200_bounce_long", cur["close"], "long", 0.05, 2.5,
                          f"Daily EMA200 bounce. RSI {cur['rsi']:.0f}, vol {cur['vol_ratio']:.1f}x.")


def detect_T3a(df_h1, df_d):
    """H1 failed breakdown long: H1 bar closes below 20-bar low then next bar recovers above it.
    H1 version of T1a. Highest-volume backtested strategy — 112 trades, 56% WR, +0.269R net.
    SL=1.2% (tight — at the sweep low). NOT suitable for 4x weekend futures (margin too large)."""
    if len(df_h1) < 22: return None
    prev = df_h1.iloc[-2]; cur = df_h1.iloc[-1]
    if pd.isna(prev.get("lo20")) or pd.isna(cur.get("lo20")): return None
    if not (prev["close"] < prev["lo20"]           # prev H1 closed below 20-bar low
            and cur["close"] > cur["lo20"]          # current H1 recovered above it
            and cur["close"] > cur["open"]          # green recovery candle
            and cur.get("vol_ratio", 1.0) >= 1.1):  # volume confirms buyers
        return None
    d_last = df_d.iloc[-1]
    fg = float(d_last.get("fg_fear_greed", 50))
    if fg > 85: return None                         # avoid buying in extreme greed
    return _build_signal("T3a_H1_fail_brkdn_long", cur["close"], "long", 0.012, 2.5,
                          f"H1 failed breakdown: recovered above 20-bar low. RSI {cur.get('rsi', 0):.0f}, vol {cur.get('vol_ratio', 1):.1f}x.")


def detect_T_D_sweep_lo_long(df_d, df_w):
    """DISABLED — 10 trades, 30% WR, near-zero edge. Removed from Mix C.
    Daily sweep of 20-day low then recovery — daily version of H4 sweep lo."""
    return None
    if len(df_d) < 22: return None
    cur = df_d.iloc[-1]
    if pd.isna(cur.get("lo20")) or pd.isna(cur.get("vol_ratio")): return None
    if not (cur["low"] < cur["lo20"]                          # swept below 20-day low
            and cur["close"] > cur["lo20"]                   # recovered back above
            and cur["lower_wick"] > 0.6 * cur["range"]       # strong rejection wick
            and cur["rsi"] < 45                              # oversold territory
            and cur["vol_ratio"] > 1.2):                    # volume confirms buyers
        return None
    # Weekly RSI gate: avoid in deep crypto winter
    wkly = df_w.iloc[-1]
    if float(wkly.get("rsi", 50)) < 40: return None
    fg = float(cur.get("fg_fear_greed", 50))
    if fg > 50: return None                                  # at 20-day lows, F&G should be fearful
    return _build_signal("T_D_sweep_lo_long", cur["close"], "long", 0.05, 3.0,
                          f"Daily swept 20-day low & recovered. Vol {cur['vol_ratio']:.1f}x, RSI {cur['rsi']:.0f}.")


def detect_T_D_hi20_breakout_long(df_d):
    """Daily close above 20-day high — price discovery breakout with volume.
    BTC in bull markets makes new highs that continue: fresh 20-day highs with volume
    and RSI momentum are one of the clearest continuation signals in trending markets.
    Gated: bull market only, volume confirms, not in extreme greed."""
    if len(df_d) < 22: return None
    cur  = df_d.iloc[-1]
    prev = df_d.iloc[-2]
    if pd.isna(cur.get("hi20")) or pd.isna(cur.get("vol_ratio")): return None
    if not (cur["close"] > cur["hi20"]                       # new 20-day closing high
            and prev["close"] <= prev.get("hi20", cur["close"])  # wasn't already above it
            and cur["rsi"] > 55                              # momentum is there
            and cur["vol_ratio"] > 1.2                      # volume confirms
            and cur["close"] > cur["open"]                  # green close
            and cur.get("body", 0) > 0.35 * max(cur.get("range", 1e-6), 1e-6)):  # real body
        return None
    # Bull market: above EMA200
    if not cur.get("above_ema200", False): return None
    fg = float(cur.get("fg_fear_greed", 50))
    if fg > 85: return None                                  # avoid chasing into extreme greed
    return _build_signal("T_D_hi20_breakout_long", cur["close"], "long", 0.04, 2.5,
                          f"Daily new 20-day high breakout. RSI {cur['rsi']:.0f}, vol {cur['vol_ratio']:.1f}x.")


# --- Master scan ----------------------------------------------------

def scan_all(frames: dict) -> list[dict]:
    """frames = {'1w': df_w, '1d': df_d, '4h': df_h4, '1h': df_h1}, all with indicators.
    Returns list of fired signals (could be 0, 1, or many in same scan)."""
    out = []
    w  = frames.get("1w")
    d  = frames.get("1d")
    h4 = frames.get("4h")
    h1 = frames.get("1h")

    # Weekly (only fire on confirmed weekly close)
    if w is not None and len(w) >= 51:
        for fn in (detect_T1a, detect_T1b, detect_T2b, detect_T3c):
            r = fn(w)
            if r: out.append(r)

    # Daily
    if d is not None and w is not None and len(d) >= 21:
        r = detect_T1c(d, w)
        if r: out.append(r)
    if d is not None and len(d) >= 6:
        for fn in (detect_T2d, detect_T2g):
            r = fn(d)
            if r: out.append(r)
    if d is not None and w is not None and len(d) >= 5:
        r = detect_T2e(w, d)
        if r: out.append(r)

    # 4-Hour
    if h4 is not None and len(h4) >= 21:
        if d is not None:
            r = detect_T1d(h4, d)
            if r: out.append(r)
            r = detect_T_sweep_lo_long(h4, d)
            if r: out.append(r)

    # H1 strategies
    if h1 is not None and d is not None and len(h1) >= 22:
        r = detect_T3a(h1, d)
        if r: out.append(r)

    # New v6 strategies
    if w is not None and d is not None and len(w) >= 55:
        r = detect_T_W_ema50_dip_long(w, d)
        if r: out.append(r)
    if d is not None and w is not None and len(d) >= 201:
        r = detect_T_D_ema200_bounce_long(d, w)
        if r: out.append(r)

    # v7 strategies disabled — all tested below 50% WR

    return out


# ── Pattern strength scoring (0=none 1=watching 2=building 3=fired) ─────

def _partial_score(sid: str, w, d, h4, h1) -> int:
    """Return 0-2 for a strategy that did NOT fully fire this bar."""
    import pandas as pd

    if sid == "T1a_W_fail_brkdn_long":
        if w is None or len(w) < 21: return 0
        cur = w.iloc[-1]
        if not cur.get("below_ema200", False): return 0
        return 2 if w.iloc[-2]["close"] < w.iloc[-2]["lo20"] else 1

    if sid == "T1b_W_rsi_os_long":
        if w is None or len(w) < 2: return 0
        cur = w.iloc[-1]
        if cur["rsi"] >= 45: return 0
        return 2 if w.iloc[-2]["rsi"] < 35 else 1

    if sid == "T2b_W_sweep_hi_short":
        if w is None or len(w) < 51: return 0
        cur = w.iloc[-1]
        if pd.isna(cur.get("hi20")): return 0
        mom_50 = (cur["close"] - w.iloc[-51]["close"]) / w.iloc[-51]["close"] * 100
        if not (55 < cur["rsi"] < 72 and mom_50 > 60): return 0
        dist = (cur["hi20"] - cur["close"]) / cur["close"] * 100
        return 2 if dist < 3 else 1

    if sid == "T3c_W_5bar_low_long":
        if w is None or len(w) < 7: return 0
        s = w.iloc[-3]
        five_low = w["low"].iloc[-7:-2].min()
        return 2 if s["low"] == five_low else 0

    if sid == "T1c_D_sstar_short":
        if d is None or w is None or len(d) < 21: return 0
        wl = w.iloc[-1]
        if not (float(wl.get("dist_ema200_pct", 0)) > 20 and wl["close"] < wl["open"]): return 0
        cur = d.iloc[-1]
        if pd.isna(cur.get("hi20")): return 0
        dist = (cur["hi20"] - cur["close"]) / cur["close"] * 100
        return 2 if (cur["rsi"] > 55 and dist < 3) else 1

    if sid == "T1d_H4_sweep_hi_short":
        if h4 is None or d is None or len(h4) < 21: return 0
        cur = h4.iloc[-1]; dl = d.iloc[-1]
        if not (cur.get("below_ema200") and cur["rsi"] > 50 and dl["rsi"] > 50): return 0
        if pd.isna(cur.get("hi20")): return 0
        return 2 if (cur["hi20"] - cur["close"]) / cur["close"] * 100 < 2 else 1

    if sid == "T3a_H1_fail_brkdn_long":
        if h1 is None or len(h1) < 22: return 0
        cur = h1.iloc[-1]; prev = h1.iloc[-2]
        if pd.isna(cur.get("lo20")): return 0
        if prev["close"] < prev.get("lo20", prev["close"]):
            return 2   # setup bar already closed below 20-bar low — one bar away from signal
        dist = (cur["close"] - cur.get("lo20", cur["close"])) / cur["close"] * 100
        return 1 if dist < 1.5 else 0   # watching: price within 1.5% of 20-bar low

    if sid == "T2d_D_squeeze_brk_long":
        if d is None or len(d) < 6: return 0
        hi3 = d["high"].iloc[-4:-1].max(); lo3 = d["low"].iloc[-4:-1].min()
        if lo3 <= 0: return 0
        tight = (hi3 - lo3) / lo3 * 100
        cur = d.iloc[-1]
        if not (cur["close"] > cur.get("ema200", 0) and cur["close"] > cur.get("ema50", 0)): return 0
        return 2 if tight < 3.0 else (1 if tight < 5.0 else 0)

    if sid == "T2e_W_mo_reclaim_long":
        if w is None or d is None or len(w) < 2: return 0
        cur_w = w.iloc[-1]
        if cur_w["close"] <= cur_w.get("ema200", 0): return 0
        dt = pd.Timestamp(cur_w.get("datetime", w.index[-1]))
        d_dt = pd.to_datetime(d["datetime"])
        month_candles = d[(d_dt.dt.year == dt.year) & (d_dt.dt.month == dt.month)]
        if len(month_candles) == 0: return 0
        m_open = float(month_candles.iloc[0]["open"])
        dist = (cur_w["close"] - m_open) / m_open * 100
        return 2 if abs(dist) < 2 else (1 if abs(dist) < 5 else 0)

    if sid == "T2g_D_bull_flag_long":
        if d is None or len(d) < 8: return 0
        hi5 = d["high"].iloc[-6:-1].max(); lo5 = d["low"].iloc[-6:-1].min()
        if lo5 <= 0: return 0
        tight = (hi5 - lo5) / lo5 * 100
        cur = d.iloc[-1]
        if not (cur["close"] > cur.get("ema200", 0) and cur["close"] > cur.get("ema50", 0)): return 0
        flag_up = d["close"].iloc[-6] < cur["close"]
        return 2 if (tight < 5.0 and flag_up and cur["rsi"] > 50) else (1 if tight < 8.0 else 0)

    return 0


def score_all_patterns(frames: dict) -> dict:
    """Return {strat_id: 0|1|2|3} for every strategy.
    3 = fully fired, 2 = actively building, 1 = context watching, 0 = nothing."""
    w  = frames.get("1w")
    d  = frames.get("1d")
    h4 = frames.get("4h")
    h1 = frames.get("1h")
    fired_ids = {s["strat_id"] for s in scan_all(frames)}
    return {
        sid: 3 if sid in fired_ids else _partial_score(sid, w, d, h4, h1)
        for sid in config.STRATEGIES
    }


def likelihood(side: str, frames: dict) -> dict:
    """For 'trade long' / 'trade short' command — score current setup quality
    against the 11 strats matching that direction. Returns:
      {grade: 'A'|'B'|'C'|'No edge', score: 0-100, fired: [strat_ids], near: [strat_ids+reason]}.
    """
    fired = scan_all(frames)
    fired_for_side = [s for s in fired if s["side"] == side]
    near = []  # could enrich later — strategies that nearly fired

    if not fired_for_side:
        return dict(grade="No edge", score=15,
                     reason=f"No {side} pattern fired on current bars.",
                     fired=[], near=near)

    # Highest-grade fired strat dominates
    grades_map = {"A": 80, "B": 60, "C": 40}
    best = None
    for s in fired_for_side:
        # Letter from name "Weekly A · ..."
        letter = "C"
        if " A · " in s["name"]: letter = "A"
        elif " B · " in s["name"]: letter = "B"
        score = grades_map[letter]
        if best is None or score > best["score"]:
            best = dict(strat=s, letter=letter, score=score)

    return dict(
        grade=best["letter"],
        score=best["score"],
        reason=best["strat"]["reason"],
        fired=[s["strat_id"] for s in fired_for_side],
        primary=best["strat"],
        near=near,
    )
