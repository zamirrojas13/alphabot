"""
3-Year Backtest — AlphaBot (all 17 strategies)
"""
import sys, time, warnings
import pandas as pd
import numpy as np
import requests
import yfinance as yf
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).parent))

from signal_engine import strategy, config, indicators

# ── Config ────────────────────────────────────────────────────────────────────
START_DATE = "2017-01-01"   # as far back as reliable BTC data exists
FEE_PER_SIDE = 0.0012       # 0.12% per side — Coinbase CFM taker (confirmed: $0.92 fee on $763.70 notional)
FEE          = FEE_PER_SIDE * 2  # 0.24% round-trip total (was 0.00125 = 0.125% round-trip, 4× too low)

# ── Data fetching ─────────────────────────────────────────────────────────────
def _yf_to_df(raw):
    """Normalise yfinance MultiIndex output."""
    df = raw.reset_index()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0].lower() for c in df.columns]
    else:
        df.columns = [c.lower() for c in df.columns]
    df = df.rename(columns={"date": "datetime", "datetime": "datetime"})
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    keep = ["datetime","open","high","low","close","volume"]
    df = df[[c for c in keep if c in df.columns]].dropna()
    return df.sort_values("datetime").reset_index(drop=True)


def fetch_daily():
    """yfinance daily BTC-USD — goes back to 2014."""
    raw = yf.download("BTC-USD", start=START_DATE, interval="1d",
                      auto_adjust=True, progress=False)
    return _yf_to_df(raw)


def fetch_fear_greed():
    """Historical Fear & Greed index from alternative.me (free, back to 2018-02-01)."""
    try:
        r = requests.get("https://api.alternative.me/fng/?limit=0&format=json", timeout=20)
        r.raise_for_status()
        rows = r.json().get("data", [])
        df = pd.DataFrame(rows)
        df["datetime"] = pd.to_datetime(df["timestamp"].astype(int), unit="s", utc=True)
        df["datetime"] = df["datetime"].dt.normalize()   # keep date only (midnight UTC)
        df["fg_fear_greed"] = df["value"].astype(int)
        return df[["datetime", "fg_fear_greed"]].sort_values("datetime").reset_index(drop=True)
    except Exception as e:
        print(f"  F&G fetch failed ({e}) — using neutral 50", flush=True)
        return pd.DataFrame()


def fetch_dxy():
    """DXY (US Dollar Index) from yfinance — downtrend = risk-on = crypto bullish."""
    try:
        raw = yf.download("DX-Y.NYB", start=START_DATE, interval="1d",
                          auto_adjust=True, progress=False)
        df = _yf_to_df(raw)
        df["dxy_ema20"]   = df["close"].ewm(span=20, adjust=False).mean()
        df["dxy_uptrend"] = (df["close"] > df["dxy_ema20"]).astype(float)  # 1=rising dollar, 0=falling
        return df[["datetime", "dxy_uptrend"]].sort_values("datetime").reset_index(drop=True)
    except Exception as e:
        print(f"  DXY fetch failed ({e}) — skipping", flush=True)
        return pd.DataFrame()


def fetch_hourly_cryptocompare():
    """
    CryptoCompare free API — BTC/USD 1H, back to 2014. Global, no auth.
    2000 bars per request, paginate backward from now to START_DATE.
    """
    url      = "https://min-api.cryptocompare.com/data/v2/histohour"
    start_ts = int(pd.Timestamp(START_DATE, tz="UTC").timestamp())
    end_ts   = int(pd.Timestamp.utcnow().timestamp())
    chunks   = []
    to_ts    = end_ts

    while to_ts > start_ts:
        params = {"fsym": "BTC", "tsym": "USD", "limit": 2000, "toTs": to_ts}
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        payload = r.json()
        data = payload.get("Data", {}).get("Data", [])
        if not data:
            break
        df = pd.DataFrame(data)
        df["datetime"] = pd.to_datetime(df["time"], unit="s", utc=True)
        df = df.rename(columns={"open":"open","high":"high","low":"low",
                                "close":"close","volumefrom":"volume"})
        df = df[["datetime","open","high","low","close","volume"]].copy()
        df = df[df["close"] > 0]
        chunks.append(df)
        oldest = int(df["datetime"].min().timestamp())
        if oldest <= start_ts:
            break
        to_ts = oldest - 1
        time.sleep(0.2)
        total = sum(len(c) for c in chunks)
        if total % 20000 < 2000:
            print(f"    ... {total:,} bars fetched", flush=True)

    if not chunks:
        return pd.DataFrame()
    out = pd.concat(chunks).drop_duplicates("datetime").sort_values("datetime").reset_index(drop=True)
    # Trim to START_DATE
    out = out[out["datetime"] >= pd.Timestamp(START_DATE, tz="UTC")].reset_index(drop=True)
    return out


def resample(df, rule):
    df2 = df.set_index("datetime")
    out = df2.resample(rule, label="left", closed="left").agg(
        {"open":"first","high":"max","low":"min","close":"last","volume":"sum"}
    ).dropna()
    return out.reset_index().sort_values("datetime").reset_index(drop=True)


# ── Indicator helpers (standalone — no strategy import needed for indicators) ─
# (We just call strategy.detect_X directly; they compute their own indicators)

# ── Trade simulator ───────────────────────────────────────────────────────────
PARTIAL_EXIT = True      # Take 50% profit at 1R, let other 50% run to TP/trail


def simulate_trade(sig, price_df, entry_bar_idx, horizon):
    """
    Simulate a trade starting at bar entry_bar_idx+1.
    If PARTIAL_EXIT=True: close 50% at 1R, trail remaining 50% to TP.
    This converts zero-trail BE exits into +0.5R wins.
    Returns dict with result stats.
    """
    side    = sig["side"]
    entry   = sig["entry"]
    sl_pct  = sig["sl_pct"]
    rr      = sig.get("rr", 2.5)
    sl_dist = entry * sl_pct

    sl = entry - sl_dist if side == "long" else entry + sl_dist
    tp = entry + sl_dist * rr if side == "long" else entry - sl_dist * rr

    be_triggered      = False
    trail_triggered   = False
    partial_done      = False   # 50% already closed at 1R
    result = "horizon"
    exit_price = None
    bars_held = 0
    exit_bar = min(entry_bar_idx + 1 + horizon, len(price_df) - 1)

    for j in range(entry_bar_idx + 1, exit_bar + 1):
        bar = price_df.iloc[j]
        bars_held += 1

        hi, lo = bar["high"], bar["low"]

        # breakeven at 1R — also triggers partial exit
        if not be_triggered:
            if side == "long" and hi >= entry + sl_dist:
                sl = entry
                be_triggered = True
                partial_done = PARTIAL_EXIT
            elif side == "short" and lo <= entry - sl_dist:
                sl = entry
                be_triggered = True
                partial_done = PARTIAL_EXIT

        # trail tighten at 1.5R
        if be_triggered and not trail_triggered:
            if side == "long" and hi >= entry + sl_dist * 1.5:
                sl = entry + sl_dist * 0.5
                trail_triggered = True
            elif side == "short" and lo <= entry - sl_dist * 1.5:
                sl = entry - sl_dist * 0.5
                trail_triggered = True

        # TP hit?
        if side == "long" and hi >= tp:
            result = "tp"; exit_price = tp; break
        if side == "short" and lo <= tp:
            result = "tp"; exit_price = tp; break

        # SL hit?
        if side == "long" and lo <= sl:
            exit_price = sl
            result = "be" if be_triggered and sl >= entry else "sl"
            break
        if side == "short" and hi >= sl:
            exit_price = sl
            result = "be" if be_triggered and sl <= entry else "sl"
            break

        # Time exit
        if j == exit_bar - 1:
            exit_price = bar["close"]
            result = "horizon"
            break

    if exit_price is None:
        exit_price = price_df.iloc[exit_bar]["close"]

    # Compute raw_r — blended if partial exit was taken
    full_raw_r = (exit_price - entry) / sl_dist if side == "long" else (entry - exit_price) / sl_dist
    if partial_done:
        # 50% closed at 1R, 50% exited at exit_price
        raw_r = 0.5 * 1.0 + 0.5 * full_raw_r
    else:
        raw_r = full_raw_r

    fee_r = FEE / sl_pct  # fee as fraction of 1R (pays twice for partial, but model keeps it simple)
    net_r = raw_r - fee_r

    return {
        "result": result,
        "bars_held": bars_held,
        "entry": entry,
        "exit": exit_price,
        "sl_pct": sl_pct,
        "raw_r": raw_r,
        "net_r": net_r,
    }


# ── Rolling detector ──────────────────────────────────────────────────────────
STRAT_DETECTOR = {
    "T1a_W_fail_brkdn_long":        ("1w", None, None, strategy.detect_T1a),
    "T1b_W_rsi_os_long":            ("1w", None, None, strategy.detect_T1b),
    "T1e_W_oversold_hammer_long":   ("1w", None, None, strategy.detect_T1e),
    "T2b_W_sweep_hi_short":         ("1w", None, None, strategy.detect_T2b),
    "T2c_W_bull_engulf_long":       ("1w", None, None, strategy.detect_T2c),
    "T2e_W_mo_reclaim_long":        ("1w", "1d", None, strategy.detect_T2e),
    "T3c_W_5bar_low_long":          ("1w", None, None, strategy.detect_T3c),
    "T1c_D_sstar_short":            ("1d", "1w", None, strategy.detect_T1c),
    "T2a_D_hammer_long":            ("1d", "1w", None, strategy.detect_T2a),
    "T2d_D_squeeze_brk_long":       ("1d", None, None, strategy.detect_T2d),
    "T2g_D_bull_flag_long":         ("1d", None, None, strategy.detect_T2g),
    "T1d_H4_sweep_hi_short":        ("4h", "1d", None, strategy.detect_T1d),
    "T1f_H4_willy_rev_short":       ("4h", "1d", "1w", strategy.detect_T1f),
    "T1g_H4_vol_surge_long":        ("4h", "1d", "1w", strategy.detect_T1g),
    "T1h_H4_vol_surge_short":       ("4h", "1d", "1w", strategy.detect_T1h),
    "T2f_H4_rsi_bear_div_short":    ("4h", None, None, strategy.detect_T2f),
    "T3b_H4_sweep_hi_short_loose":  ("4h", "1d", None, strategy.detect_T3b),
    # v6 new strategies
    "T_H4_sweep_lo_long":           ("4h", "1d", None, strategy.detect_T_sweep_lo_long),
    "T_W_ema50_dip_long":           ("1w", "1d", None, strategy.detect_T_W_ema50_dip_long),
    "T_D_ema200_bounce_long":       ("1d", "1w", None, strategy.detect_T_D_ema200_bounce_long),
    # v7 new strategies
    "T_H4_ema21_bounce_long":       ("4h", "1d", None, strategy.detect_T_H4_ema21_bounce_long),
    "T_D_2bar_pullback_long":       ("1d", None, None, strategy.detect_T_D_2bar_pullback_long),
    "T_D_sweep_lo_long":            ("1d", "1w", None, strategy.detect_T_D_sweep_lo_long),
    "T_D_hi20_breakout_long":       ("1d", None, None, strategy.detect_T_D_hi20_breakout_long),
}

DETECTOR_ARGS = {
    "T2e_W_mo_reclaim_long":  lambda w, d, h: (w, d),
    "T1c_D_sstar_short":      lambda d, w, h: (d, w),
    "T2a_D_hammer_long":      lambda d, w, h: (d, w),
    "T1d_H4_sweep_hi_short":  lambda h, d, w: (h, d),
    "T1f_H4_willy_rev_short": lambda h, d, w: (h, d, w),
    "T1g_H4_vol_surge_long":  lambda h, d, w: (h, d, w),
    "T1h_H4_vol_surge_short": lambda h, d, w: (h, d, w),
    "T3b_H4_sweep_hi_short_loose": lambda h, d, w: (h, d),
    # v6 new strategies
    "T_H4_sweep_lo_long":     lambda h, d, w: (h, d),
    "T_W_ema50_dip_long":     lambda w, d, h: (w, d),
    "T_D_ema200_bounce_long": lambda d, w, h: (d, w),
    # v7 new strategies
    "T_H4_ema21_bounce_long": lambda h, d, w: (h, d),
    "T_D_2bar_pullback_long": lambda d, w, h: (d,),
    "T_D_sweep_lo_long":      lambda d, w, h: (d, w),
    "T_D_hi20_breakout_long": lambda d, w, h: (d,),
}


def get_args(name, prim, sec, tert):
    fn = DETECTOR_ARGS.get(name)
    if fn:
        return fn(prim, sec, tert)
    return (prim,)


def slice_to_date(df, dt):
    """Return rows of df with datetime <= dt."""
    return df[df["datetime"] <= dt].copy()


def run_strategy(name, cfg, dfs, horizon_override=None):
    """Run rolling detector on full history, simulate all trades."""
    tf1 = cfg["tf"]
    horizon = horizon_override or cfg["horizon"]
    sl_pct = cfg["sl"]
    rr = cfg["rr"]

    prim_df = dfs.get(tf1)
    if prim_df is None or len(prim_df) < 30:
        return []

    det = STRAT_DETECTOR[name][3]
    tf2 = STRAT_DETECTOR[name][1]
    tf3 = STRAT_DETECTOR[name][2]
    sec_df  = dfs.get(tf2) if tf2 else None
    tert_df = dfs.get(tf3) if tf3 else None

    # Indicators are pre-computed on full df — just slice
    min_bars = 220  # enough for EMA200 to warm up
    trades = []
    in_trade_until = None

    for i in range(min_bars, len(prim_df) - 1):
        if in_trade_until and i <= in_trade_until:
            continue

        bar_dt = prim_df.iloc[i]["datetime"]
        # Slice: give detector data UP TO AND INCLUDING bar i
        p_slice = prim_df.iloc[:i+1]
        s_slice = slice_to_date(sec_df, bar_dt) if sec_df is not None else None
        t_slice = slice_to_date(tert_df, bar_dt) if tert_df is not None else None

        try:
            args = get_args(name, p_slice, s_slice, t_slice)
            sig = det(*args)
        except Exception:
            continue

        if sig is None:
            continue

        sig["sl_pct"] = sl_pct
        sig["rr"] = rr

        t = simulate_trade(sig, prim_df, i, horizon)
        t["bar_date"] = bar_dt
        t["strategy"] = name
        t["horizon_used"] = horizon
        trades.append(t)

        gap = cfg.get("gap", horizon // 2)
        in_trade_until = i + gap

    return trades


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 65)
    print("  AlphaBot Full Backtest 2017-present (all 17 strategies)")
    print("=" * 65)

    # ── Fetch data ─────────────────────────────────────────────────────
    print(f"\n[1/4] Fetching data (from {START_DATE})...")

    print(f"  Daily  (yfinance) ...", end=" ", flush=True)
    df_d = fetch_daily()
    print(f"got {len(df_d)} bars  ({df_d['datetime'].min().date()} to {df_d['datetime'].max().date()})")

    print(f"  Hourly (CryptoCompare, paginating from {START_DATE}) ...")
    df_h1 = fetch_hourly_cryptocompare()
    print(f"  got {len(df_h1):,} hourly bars  ({df_h1['datetime'].min().date()} to {df_h1['datetime'].max().date()})")

    df_4h = resample(df_h1, "4h") if not df_h1.empty else pd.DataFrame()
    df_w  = resample(df_d,  "W-MON") if not df_d.empty else pd.DataFrame()

    print(f"  4H bars: {len(df_4h)}  |  Weekly bars: {len(df_w)}")

    # Pre-compute indicators on full datasets (once, not per-slice)
    print("  Adding indicators ...", end=" ", flush=True)
    df_d  = indicators.add_indicators(df_d.copy())
    df_4h = indicators.add_indicators(df_4h.copy()) if not df_4h.empty else df_4h
    df_w  = indicators.add_indicators(df_w.copy())  if not df_w.empty  else df_w
    print("done")

    # ── Macro data: Fear & Greed + DXY ────────────────────────────────
    print("  Fetching Fear & Greed ...", end=" ", flush=True)
    df_fg = fetch_fear_greed()
    if not df_fg.empty:
        # Merge on date (df_d datetime is tz-aware UTC, normalise to midnight)
        df_d["_date"] = df_d["datetime"].dt.normalize()
        df_fg = df_fg.rename(columns={"datetime": "_date"})
        df_d = df_d.merge(df_fg, on="_date", how="left")
        df_d["fg_fear_greed"] = df_d["fg_fear_greed"].fillna(50).astype(int)
        df_d = df_d.drop(columns=["_date"])
        print(f"merged {len(df_fg)} days", flush=True)
    else:
        df_d["fg_fear_greed"] = 50
        print("skipped (neutral 50)", flush=True)

    print("  Fetching DXY ...", end=" ", flush=True)
    df_dxy = fetch_dxy()
    if not df_dxy.empty:
        df_d["_date"] = df_d["datetime"].dt.normalize()
        df_dxy = df_dxy.rename(columns={"datetime": "_date"})
        df_d = df_d.merge(df_dxy, on="_date", how="left")
        df_d["dxy_uptrend"] = df_d["dxy_uptrend"].fillna(0.5)
        df_d = df_d.drop(columns=["_date"])
        print(f"merged {len(df_dxy)} days", flush=True)
    else:
        df_d["dxy_uptrend"] = 0.5
        print("skipped", flush=True)

    dfs = {"1d": df_d, "4h": df_4h, "1w": df_w}

    # ── Run strategies at CURRENT horizons ────────────────────────────
    print("\n[2/4] Running detectors at current horizons ...")
    all_trades_cur = {}
    for name, cfg in config.STRATEGIES.items():
        trades = run_strategy(name, cfg, dfs)
        all_trades_cur[name] = trades
        n = len(trades)
        if n:
            wr = sum(1 for t in trades if t["net_r"] > 0) / n * 100
            avg = sum(t["net_r"] for t in trades) / n
            print(f"  {name:40s}  {n:3d} trades  WR={wr:4.0f}%  avg={avg:+.2f}R")
        else:
            print(f"  {name:40s}    0 trades")

    # ── Run strategies at EXTENDED horizons (1.5×) ───────────────────
    print("\n[3/4] Running detectors at extended horizons (1.5×) ...")
    all_trades_ext = {}
    for name, cfg in config.STRATEGIES.items():
        ext_h = int(cfg["horizon"] * 1.5)
        trades = run_strategy(name, cfg, dfs, horizon_override=ext_h)
        all_trades_ext[name] = trades

    # ── Summary comparison ─────────────────────────────────────────────
    print("\n[4/4] Results comparison\n")
    print(f"{'Strategy':<42} {'H':>3}  {'N':>3}  {'WR%':>5}  {'avgR':>6}  "
          f"{'Hx1.5':>5}  {'N':>3}  {'WR%':>5}  {'avgR':>6}  {'dR':>6}")
    print("-" * 100)

    for name, cfg in config.STRATEGIES.items():
        cur  = all_trades_cur.get(name, [])
        ext  = all_trades_ext.get(name, [])
        h    = cfg["horizon"]
        hx   = int(h * 1.5)

        def stats(trades):
            n = len(trades)
            if n == 0:
                return 0, 0.0, 0.0
            wr = sum(1 for t in trades if t["net_r"] > 0) / n * 100
            avg = sum(t["net_r"] for t in trades) / n
            return n, wr, avg

        nc, wrc, avgc = stats(cur)
        ne, wre, avge = stats(ext)
        delta = avge - avgc

        flag = "^" if delta > 0.05 else ("v" if delta < -0.05 else "~")
        print(f"{name:<42} {h:>3}  {nc:>3}  {wrc:>5.1f}  {avgc:>+6.2f}R  "
              f"{hx:>5}  {ne:>3}  {wre:>5.1f}  {avge:>+6.2f}R  {delta:>+5.2f}{flag}")

    # ── Overall totals ─────────────────────────────────────────────────
    print("\n" + "=" * 65)
    all_c = [t for ts in all_trades_cur.values() for t in ts]
    all_e = [t for ts in all_trades_ext.values() for t in ts]

    for label, trades in [("Current horizons", all_c), ("Extended ×1.5", all_e)]:
        n = len(trades)
        if n:
            wr = sum(1 for t in trades if t["net_r"] > 0) / n * 100
            avg = sum(t["net_r"] for t in trades) / n
            total_r = sum(t["net_r"] for t in trades)
            tp = sum(1 for t in trades if t["result"] == "tp") / n * 100
            sl = sum(1 for t in trades if t["result"] == "sl") / n * 100
            be = sum(1 for t in trades if t["result"] == "be") / n * 100
            ho = sum(1 for t in trades if t["result"] == "horizon") / n * 100
            print(f"\n{label}: {n} trades | WR={wr:.1f}% | avg={avg:+.2f}R | total={total_r:+.1f}R")
            print(f"  Exit mix: TP={tp:.0f}%  SL={sl:.0f}%  BE={be:.0f}%  Time={ho:.0f}%")

    # ── Pattern improvements ───────────────────────────────────────────
    print("\n" + "=" * 65)
    print("Improvement patterns (extended horizon helps ^):\n")
    improvers, decliners = [], []
    for name, cfg in config.STRATEGIES.items():
        cur  = all_trades_cur.get(name, [])
        ext  = all_trades_ext.get(name, [])
        if not cur or not ext:
            continue
        avgc = sum(t["net_r"] for t in cur) / len(cur)
        avge = sum(t["net_r"] for t in ext) / len(ext)
        delta = avge - avgc
        if delta > 0.05:
            improvers.append((name, cfg["tf"], delta, cfg["horizon"]))
        elif delta < -0.05:
            decliners.append((name, cfg["tf"], delta, cfg["horizon"]))

    print("  Benefits from longer hold:")
    for n, tf, d, h in sorted(improvers, key=lambda x: -x[2]):
        print(f"    {n} [{tf}] h={h}->{int(h*1.5)}: +{d:.2f}R avg improvement")

    print("\n  Hurt by longer hold (current horizon is better):")
    for n, tf, d, h in sorted(decliners, key=lambda x: x[2]):
        print(f"    {n} [{tf}] h={h}->{int(h*1.5)}: {d:.2f}R avg degradation")

    # ── Fee impact comparison ──────────────────────────────────────────
    all_c_flat = [t for ts in all_trades_cur.values() for t in ts]
    _print_fee_comparison(all_c_flat)

    print("\nBacktest complete.")


NANO_BTC   = 0.01   # 1 nano contract = 0.01 BTC
RISK_PCT   = 0.005  # 0.5% equity risk per T1 trade
START_EQ   = 10_000.0


def _equity_simulation(all_trades, fee_per_side=FEE_PER_SIDE, start=START_EQ):
    """
    Dollar equity simulation with realistic position sizing + fees.
    Trades processed chronologically; overlapping signals treated as sequential.
    Returns: (final_equity, max_dd_pct, total_fees, yearly_results)
    """
    from collections import defaultdict
    import datetime as _dt

    sorted_trades = sorted(all_trades, key=lambda t: t.get("bar_date", _dt.datetime.min))
    equity = start
    peak   = start
    max_dd = 0.0
    total_fees = 0.0
    yearly = defaultdict(lambda: {"pnl": 0.0, "fees": 0.0, "trades": 0})

    for t in sorted_trades:
        entry  = t["entry"]
        exit_p = t["exit"]
        sl_pct = t.get("sl_pct", 0.015)
        raw_r  = t["raw_r"]

        # Position sizing: risk 0.5% of equity per trade
        sl_dist          = entry * sl_pct
        risk_per_contract = sl_dist * NANO_BTC
        if risk_per_contract <= 0:
            continue
        contracts = max(1, int(equity * RISK_PCT / risk_per_contract))
        qty_btc   = contracts * NANO_BTC

        # Dollar P&L (gross)
        pnl_gross = qty_btc * entry * sl_pct * raw_r

        # Dollar fees at actual fill prices
        entry_fee  = qty_btc * entry  * fee_per_side
        exit_fee   = qty_btc * exit_p * fee_per_side
        fee_total  = entry_fee + exit_fee
        pnl_net    = pnl_gross - fee_total

        equity     += pnl_net
        total_fees += fee_total

        if equity > peak:
            peak = equity
        dd = (equity - peak) / peak * 100 if peak > 0 else 0
        if dd < max_dd:
            max_dd = dd

        yr = t["bar_date"].year if hasattr(t["bar_date"], "year") else 0
        yearly[yr]["pnl"]    += pnl_net
        yearly[yr]["fees"]   += fee_total
        yearly[yr]["trades"] += 1

    return equity, max_dd, total_fees, dict(yearly)


def _cagr(final_eq, start_eq, years):
    if years <= 0 or start_eq <= 0:
        return 0.0
    return ((final_eq / start_eq) ** (1 / years) - 1) * 100


def _print_fee_comparison(all_trades):
    """Print side-by-side comparison: no fees vs 0.12%/side fees."""
    import datetime as _dt
    dates = [t["bar_date"] for t in all_trades if hasattr(t.get("bar_date"), "year")]
    if not dates:
        print("\n[Fee comparison] no dated trades found.")
        return
    years = (max(dates) - min(dates)).days / 365.25

    eq0, dd0, fees0, yr0 = _equity_simulation(all_trades, fee_per_side=0)
    eq1, dd1, fees1, yr1 = _equity_simulation(all_trades, fee_per_side=FEE_PER_SIDE)

    cagr0 = _cagr(eq0, START_EQ, years)
    cagr1 = _cagr(eq1, START_EQ, years)
    cal0  = abs(cagr0 / dd0) if dd0 else 0
    cal1  = abs(cagr1 / dd1) if dd1 else 0

    print("\n" + "=" * 65)
    print("  Fee Impact: v9 No Fees vs 0.12%/side (Coinbase CFM taker)")
    print("=" * 65)
    print(f"{'Metric':<22} {'No fees':>14} {'0.12%/side fees':>16} {'Delta':>10}")
    print("-" * 65)
    print(f"{'Final equity':<22} ${eq0:>13,.0f} ${eq1:>15,.0f} {(eq1-eq0)/eq0*100:>+9.1f}%")
    print(f"{'CAGR':<22} {cagr0:>13.1f}% {cagr1:>15.1f}%  {cagr1-cagr0:>+8.1f}pp")
    print(f"{'Max Drawdown':<22} {dd0:>13.1f}% {dd1:>15.1f}%  {dd1-dd0:>+8.1f}pp")
    print(f"{'Calmar':<22} {cal0:>13.2f} {cal1:>15.2f}  {cal1-cal0:>+9.2f}")
    print(f"{'Total fees paid':<22} {'—':>14} ${fees1:>14,.0f}  {'—':>10}")

    # Yearly breakdown
    print("\n  Yearly fees with 0.12%/side:")
    for yr in sorted(yr1.keys()):
        d = yr1[yr]
        print(f"    {yr}: {d['trades']:3d} trades  fees ${d['fees']:,.0f}  net_pnl ${d['pnl']:+,.0f}")


if __name__ == "__main__":
    main()
