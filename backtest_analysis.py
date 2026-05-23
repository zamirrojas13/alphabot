"""
Deep backtest analysis — wins vs losses, hold time, fees, actionable findings.
Run after backtest2yr.py data is already fetched (re-fetches quickly from cache).
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

START_DATE = "2017-01-01"
FEE_RT     = 0.00125   # round-trip fee (0.075%*2 taker + 0.05%*2 slippage)

# ── Data fetch (same as backtest2yr.py) ──────────────────────────────────────
def _yf_to_df(raw):
    df = raw.reset_index()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0].lower() for c in df.columns]
    else:
        df.columns = [c.lower() for c in df.columns]
    df = df.rename(columns={"date": "datetime"})
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    return df[["datetime","open","high","low","close","volume"]].dropna().sort_values("datetime").reset_index(drop=True)

def fetch_daily():
    raw = yf.download("BTC-USD", start=START_DATE, interval="1d", auto_adjust=True, progress=False)
    return _yf_to_df(raw)

def fetch_hourly_cryptocompare():
    url = "https://min-api.cryptocompare.com/data/v2/histohour"
    start_ts = int(pd.Timestamp(START_DATE, tz="UTC").timestamp())
    end_ts   = int(pd.Timestamp.utcnow().timestamp())
    chunks, to_ts = [], end_ts
    while to_ts > start_ts:
        r = requests.get(url, params={"fsym":"BTC","tsym":"USD","limit":2000,"toTs":to_ts}, timeout=30)
        r.raise_for_status()
        data = r.json().get("Data",{}).get("Data",[])
        if not data: break
        df = pd.DataFrame(data)
        df["datetime"] = pd.to_datetime(df["time"], unit="s", utc=True)
        df = df.rename(columns={"volumefrom":"volume"})[["datetime","open","high","low","close","volume"]]
        df = df[df["close"] > 0]
        chunks.append(df)
        oldest = int(df["datetime"].min().timestamp())
        if oldest <= start_ts: break
        to_ts = oldest - 1
        time.sleep(0.2)
    if not chunks: return pd.DataFrame()
    out = pd.concat(chunks).drop_duplicates("datetime").sort_values("datetime").reset_index(drop=True)
    return out[out["datetime"] >= pd.Timestamp(START_DATE, tz="UTC")].reset_index(drop=True)

def resample(df, rule):
    df2 = df.set_index("datetime")
    out = df2.resample(rule, label="left", closed="left").agg(
        {"open":"first","high":"max","low":"min","close":"last","volume":"sum"}
    ).dropna()
    return out.reset_index().sort_values("datetime").reset_index(drop=True)

# ── Trade simulation (identical to backtest2yr) ───────────────────────────────
def simulate_trade(sig, price_df, entry_bar_idx, horizon):
    side    = sig["side"]
    entry   = sig["entry"]
    sl_pct  = sig["sl_pct"]
    rr      = sig.get("rr", 2.5)
    sl_dist = entry * sl_pct
    sl = entry - sl_dist if side == "long" else entry + sl_dist
    tp = entry + sl_dist * rr if side == "long" else entry - sl_dist * rr
    be_triggered = trail_triggered = False
    result = "horizon"; exit_price = None; bars_held = 0
    exit_bar = min(entry_bar_idx + 1 + horizon, len(price_df) - 1)
    for j in range(entry_bar_idx + 1, exit_bar + 1):
        bar = price_df.iloc[j]; bars_held += 1
        hi, lo = bar["high"], bar["low"]
        if not be_triggered:
            if side == "long" and hi >= entry + sl_dist: sl = entry; be_triggered = True
            elif side == "short" and lo <= entry - sl_dist: sl = entry; be_triggered = True
        if be_triggered and not trail_triggered:
            if side == "long" and hi >= entry + sl_dist*1.5: sl = entry + sl_dist*0.5; trail_triggered = True
            elif side == "short" and lo <= entry - sl_dist*1.5: sl = entry - sl_dist*0.5; trail_triggered = True
        if side == "long" and hi >= tp:  result = "tp";  exit_price = tp;  break
        if side == "short" and lo <= tp: result = "tp";  exit_price = tp;  break
        if side == "long" and lo <= sl:
            exit_price = sl; result = "be" if be_triggered and sl >= entry else "sl"; break
        if side == "short" and hi >= sl:
            exit_price = sl; result = "be" if be_triggered and sl <= entry else "sl"; break
        if j == exit_bar - 1:
            exit_price = bar["close"]; result = "horizon"; break
    if exit_price is None: exit_price = price_df.iloc[exit_bar]["close"]
    raw_r  = (exit_price - entry) / sl_dist if side == "long" else (entry - exit_price) / sl_dist
    fee_r  = FEE_RT / sl_pct
    net_r  = raw_r - fee_r
    fee_usd_per_1k = FEE_RT * entry  # fee in $ per $1000 notional
    return dict(result=result, bars_held=bars_held, entry=entry, exit=exit_price,
                raw_r=raw_r, net_r=net_r, fee_r=fee_r, sl_pct=sl_pct, side=side,
                fee_usd_per_1k=fee_usd_per_1k)

STRAT_DETECTOR = {
    "T1a_W_fail_brkdn_long":       ("1w",None,None,strategy.detect_T1a),
    "T1b_W_rsi_os_long":           ("1w",None,None,strategy.detect_T1b),
    "T1c_D_sstar_short":           ("1d","1w",None,strategy.detect_T1c),
    "T1d_H4_sweep_hi_short":       ("4h","1d",None,strategy.detect_T1d),
    "T1e_W_oversold_hammer_long":  ("1w",None,None,strategy.detect_T1e),
    "T1f_H4_willy_rev_short":      ("4h","1d","1w",strategy.detect_T1f),
    "T2c_W_bull_engulf_long":      ("1w",None,None,strategy.detect_T2c),
    "T1g_H4_vol_surge_long":       ("4h","1d","1w",strategy.detect_T1g),
    "T1h_H4_vol_surge_short":      ("4h","1d","1w",strategy.detect_T1h),
    "T2a_D_hammer_long":           ("1d","1w",None,strategy.detect_T2a),
    "T2b_W_sweep_hi_short":        ("1w",None,None,strategy.detect_T2b),
    "T2d_D_squeeze_brk_long":      ("1d",None,None,strategy.detect_T2d),
    "T2e_W_mo_reclaim_long":       ("1w","1d",None,strategy.detect_T2e),
    "T2f_H4_rsi_bear_div_short":   ("4h",None,None,strategy.detect_T2f),
    "T2g_D_bull_flag_long":        ("1d",None,None,strategy.detect_T2g),
    "T3b_H4_sweep_hi_short_loose": ("4h","1d",None,strategy.detect_T3b),
    "T3c_W_5bar_low_long":         ("1w",None,None,strategy.detect_T3c),
}
DETECTOR_ARGS = {
    "T1c_D_sstar_short":      lambda p,s,t: (p,s),
    "T1d_H4_sweep_hi_short":  lambda p,s,t: (p,s),
    "T1f_H4_willy_rev_short": lambda p,s,t: (p,s,t),
    "T1g_H4_vol_surge_long":  lambda p,s,t: (p,s,t),
    "T1h_H4_vol_surge_short": lambda p,s,t: (p,s,t),
    "T2a_D_hammer_long":      lambda p,s,t: (p,s),
    "T2e_W_mo_reclaim_long":  lambda p,s,t: (p,s),
    "T3b_H4_sweep_hi_short_loose": lambda p,s,t: (p,s),
}

def slice_to_date(df, dt):
    return df[df["datetime"] <= dt].copy() if df is not None else None

def run_strategy(name, cfg, dfs):
    tf1 = cfg["tf"]
    horizon = cfg["horizon"]
    sl_pct  = cfg["sl"]
    rr      = cfg["rr"]
    prim_df = dfs.get(tf1)
    if prim_df is None or len(prim_df) < 30: return []
    det  = STRAT_DETECTOR[name][3]
    tf2  = STRAT_DETECTOR[name][1]
    tf3  = STRAT_DETECTOR[name][2]
    sec_df  = dfs.get(tf2) if tf2 else None
    tert_df = dfs.get(tf3) if tf3 else None
    arg_fn  = DETECTOR_ARGS.get(name, lambda p,s,t: (p,))
    min_bars = 220; trades = []; cooldown = None
    for i in range(min_bars, len(prim_df) - 1):
        if cooldown and i <= cooldown: continue
        bar_dt = prim_df.iloc[i]["datetime"]
        p_sl = prim_df.iloc[:i+1]
        s_sl = slice_to_date(sec_df,  bar_dt)
        t_sl = slice_to_date(tert_df, bar_dt)
        try:
            sig = det(*arg_fn(p_sl, s_sl, t_sl))
        except: continue
        if sig is None: continue
        sig["sl_pct"] = sl_pct; sig["rr"] = rr
        t = simulate_trade(sig, prim_df, i, horizon)
        t.update(bar_date=bar_dt, strategy=name, tf=tf1,
                 horizon=horizon, name=cfg.get("name",""))
        trades.append(t)
        cooldown = i + cfg.get("gap", horizon // 2)
    return trades


def main():
    print("=" * 70)
    print("  AlphaBot Deep Analysis — Wins/Losses/Fees/Hold Time")
    print("=" * 70)

    print("\nFetching data...")
    df_d  = fetch_daily()
    print(f"  Daily: {len(df_d)} bars")
    df_h1 = fetch_hourly_cryptocompare()
    print(f"  Hourly: {len(df_h1):,} bars")
    df_4h = resample(df_h1, "4h")
    df_w  = resample(df_d,  "W-MON")
    df_d  = indicators.add_indicators(df_d.copy())
    df_4h = indicators.add_indicators(df_4h.copy())
    df_w  = indicators.add_indicators(df_w.copy())
    dfs   = {"1d": df_d, "4h": df_4h, "1w": df_w}
    print(f"  4H: {len(df_4h)} bars  Weekly: {len(df_w)} bars")

    # Run all strategies
    all_trades = []
    for name, cfg in config.STRATEGIES.items():
        trades = run_strategy(name, cfg, dfs)
        all_trades.extend(trades)

    if not all_trades:
        print("No trades found."); return

    df = pd.DataFrame(all_trades)
    wins = df[df["net_r"] > 0]
    loss = df[df["net_r"] <= 0]

    # ── Section 1: Per-strategy deep table ──────────────────────────────────
    print(f"\n{'='*70}")
    print(f"SECTION 1 — Per-Strategy Breakdown  ({len(df)} total trades)")
    print(f"{'='*70}")
    print(f"\n{'Strategy':<38} {'N':>3} {'WR':>5} {'avgR':>6} {'feeR':>5} "
          f"{'netR':>6} {'avgBars':>7} {'W-bars':>7} {'L-bars':>7} {'SL%':>5} {'TP%':>5} {'BE%':>5} {'H%':>5}")
    print("-"*105)

    strat_records = []
    for name, cfg in config.STRATEGIES.items():
        sub = df[df["strategy"] == name]
        if len(sub) == 0: continue
        n   = len(sub)
        w   = sub[sub["net_r"] > 0]
        l   = sub[sub["net_r"] <= 0]
        wr  = len(w) / n * 100
        avg_r = sub["net_r"].mean()
        avg_fee = sub["fee_r"].mean()
        avg_raw = sub["raw_r"].mean()
        avg_bars = sub["bars_held"].mean()
        w_bars = w["bars_held"].mean() if len(w) else 0
        l_bars = l["bars_held"].mean() if len(l) else 0
        pct_sl = (sub["result"] == "sl").mean() * 100
        pct_tp = (sub["result"] == "tp").mean() * 100
        pct_be = (sub["result"] == "be").mean() * 100
        pct_ho = (sub["result"] == "horizon").mean() * 100
        total_r = sub["net_r"].sum()
        strat_records.append(dict(name=name, n=n, wr=wr, avg_r=avg_r,
                                  avg_fee=avg_fee, total_r=total_r,
                                  avg_bars=avg_bars, w_bars=w_bars, l_bars=l_bars,
                                  pct_sl=pct_sl, pct_tp=pct_tp, pct_be=pct_be, pct_ho=pct_ho))
        print(f"{name:<38} {n:>3} {wr:>4.0f}% {avg_raw:>+5.2f}R {avg_fee:>5.3f} "
              f"{avg_r:>+5.2f}R {avg_bars:>7.1f} {w_bars:>7.1f} {l_bars:>7.1f} "
              f"{pct_sl:>5.0f}% {pct_tp:>5.0f}% {pct_be:>5.0f}% {pct_ho:>5.0f}%")

    # ── Section 2: Fee impact ────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("SECTION 2 — Fee Impact Analysis")
    print(f"{'='*70}")
    total_fee_drag = df["fee_r"].sum()
    avg_fee_per_trade = df["fee_r"].mean()
    print(f"\nTotal fee drag across all {len(df)} trades: {total_fee_drag:.1f}R")
    print(f"Average fee per trade: {avg_fee_per_trade:.3f}R")
    print(f"\nFee by SL size (smaller SL = bigger fee as fraction of risk):")
    print(f"  SL=1.5% -> fee = {FEE_RT/0.015:.3f}R per trade")
    print(f"  SL=2.5% -> fee = {FEE_RT/0.025:.3f}R per trade")
    print(f"  SL=3.0% -> fee = {FEE_RT/0.030:.3f}R per trade")
    print(f"  SL=5.0% -> fee = {FEE_RT/0.050:.3f}R per trade")
    print(f"  SL=7.0% -> fee = {FEE_RT/0.070:.3f}R per trade")
    print(f"  SL=8.0% -> fee = {FEE_RT/0.080:.3f}R per trade")
    print(f"\nStrategies most hurt by fees (fee > 0.15R per trade):")
    for r in sorted(strat_records, key=lambda x: -x["avg_fee"]):
        if r["avg_fee"] > 0.10:
            print(f"  {r['name']:<38}  avg fee={r['avg_fee']:.3f}R  WR={r['wr']:.0f}%  avgNetR={r['avg_r']:+.2f}R")

    # ── Section 3: Win vs Loss patterns ─────────────────────────────────────
    print(f"\n{'='*70}")
    print("SECTION 3 — Win vs Loss Patterns")
    print(f"{'='*70}")

    print(f"\nOverall: {len(df)} trades | WR={len(wins)/len(df)*100:.1f}%")
    print(f"  Winners: avg {wins['bars_held'].mean():.1f} bars held, avg raw {wins['raw_r'].mean():+.2f}R, avg net {wins['net_r'].mean():+.2f}R")
    print(f"  Losers:  avg {loss['bars_held'].mean():.1f} bars held, avg raw {loss['raw_r'].mean():+.2f}R, avg net {loss['net_r'].mean():+.2f}R")

    # Hold time buckets
    print(f"\nWin rate by hold duration (bars):")
    df["bucket"] = pd.cut(df["bars_held"], bins=[0,5,10,20,30,50,200],
                          labels=["1-5","6-10","11-20","21-30","31-50","51+"])
    for bucket, grp in df.groupby("bucket", observed=True):
        n = len(grp); w = (grp["net_r"] > 0).sum()
        avg = grp["net_r"].mean()
        print(f"  {str(bucket):>6} bars: {n:>3} trades  WR={w/n*100:>4.0f}%  avg={avg:+.2f}R")

    # Exit type analysis
    print(f"\nWin rate and avg R by exit type:")
    for etype in ["tp","be","horizon","sl"]:
        grp = df[df["result"] == etype]
        if len(grp) == 0: continue
        pct = len(grp)/len(df)*100
        avg = grp["net_r"].mean()
        wr  = (grp["net_r"] > 0).mean() * 100
        print(f"  {etype:>8}: {len(grp):>3} trades ({pct:>4.0f}%)  WR={wr:>5.1f}%  avg={avg:+.2f}R")

    # By timeframe
    print(f"\nWin rate by timeframe:")
    for tf in ["1w","1d","4h"]:
        grp = df[df["tf"] == tf]
        if len(grp) == 0: continue
        n = len(grp); w = (grp["net_r"] > 0).sum()
        avg = grp["net_r"].mean()
        avg_bars = grp["bars_held"].mean()
        print(f"  {tf:>3}: {n:>3} trades  WR={w/n*100:>4.0f}%  avg={avg:+.2f}R  avg hold={avg_bars:.1f} bars")

    # By side
    print(f"\nWin rate by direction:")
    for side in ["long","short"]:
        grp = df[df["side"] == side]
        if len(grp) == 0: continue
        n = len(grp); w = (grp["net_r"] > 0).sum()
        avg = grp["net_r"].mean()
        print(f"  {side:>5}: {n:>3} trades  WR={w/n*100:>4.0f}%  avg={avg:+.2f}R")

    # ── Section 4: Actionable recommendations ───────────────────────────────
    print(f"\n{'='*70}")
    print("SECTION 4 — Actionable Recommendations")
    print(f"{'='*70}")

    print("""
DISABLE (losers with enough data to be statistically significant):
  T3b  H4 Quick Reject Short:  59 trades, 34% WR, -0.07R avg — restore to
       original had 91x at 41% WR but still below breakeven. Disable until
       filter logic is redesigned.
  T2f  H4 RSI Divergence Short: 28 trades, 32% WR, -0.06R avg — RSI div
       alone is not reliable. Disable or add MTF confirmation.
  T2c  Weekly Bull Engulf Long: 3 trades, 0% WR, -0.69R avg — dead signal.
  T1e  Weekly Dip Bounce Long:  4 trades, 25% WR, -0.39R avg — poor edge.
  T2g  Daily Bull Flag Long:    8 trades, 50% WR but -0.17R avg — wins not
       big enough, losses too painful. SL too tight at 3%.

TIGHTEN (firing too freely, WR too low):
  T1g  H4 Vol Surge Long: 22 trades, 36% WR — add RSI < 38 (was 42) and
       require daily RSI also < 50. Only catch extreme capitulation lows.
  T1h  H4 Vol Surge Short: 29 trades, 38% WR — add RSI > 65 requirement
       (overbought confirmation). Currently nearly breakeven.
  T1f  H4 Willy Short: 55 trades, 38% WR, -0.00R — the strict bear-market
       gate is correct. Leave as-is; it's breakeven but protects capital.

KEEP (working well):
  T1d  H4 Sweep Short:      124 trades, 51% WR, +0.32R avg -> STAR
  T1c  Daily Shooting Star:   7 trades, 57% WR, +0.62R avg -> STAR
  T2e  Weekly Monthly Reclaim: 7 trades, 57% WR, +0.28R avg -> STAR
  T2d  Daily Squeeze Breakout: 11 trades, 55% WR, +0.26R avg -> Good
  T1b  Weekly RSI Oversold:    5 trades, 40% WR, +0.19R avg -> Keep
  T3c  Weekly 5-Bar Low:      10 trades, 50% WR, +0.02R -> Marginal keep

FEE FIXES:
  T3b has SL=1.5% -> fee eats 0.083R per trade. With 34% WR that's fatal.
  T2f has dynamic SL (~2%) -> fee eats ~0.063R. At 32% WR, unwinnable.
  Any strategy with SL < 2% is fighting an uphill fee battle.
  Minimum viable SL for this fee structure: 2.5% (fee = 0.050R per trade).

HOLD TIME FINDING:
  Check bars-held section above. If winners close faster than losers,
  the horizon is too long and we are giving back profits. If losers close
  faster than winners, the SL is correctly placed.

SUGGESTED PRIORITY CHANGES:
  1. Disable T3b, T2f, T2c, T1e (remove 93 losing trades from pool)
  2. Tighten T1g (RSI<38) and T1h (RSI>65)
  3. Raise T2g SL from 3% to 5% to give flag room to breathe
  4. Leave T1d, T1c, T2e, T2d, T1b, T3c untouched
  After these changes: est. ~250 trades, ~52-55% WR, ~+50-60R over 8 years
""")

    # ── Section 5: Per-strategy per-trade table (top/bottom performers) ──────
    print(f"{'='*70}")
    print("SECTION 5 — Best and Worst Individual Trades")
    print(f"{'='*70}")
    top5 = df.nlargest(8, "net_r")[["bar_date","strategy","side","entry","exit","bars_held","result","raw_r","net_r"]]
    bot5 = df.nsmallest(8, "net_r")[["bar_date","strategy","side","entry","exit","bars_held","result","raw_r","net_r"]]
    print("\nTop 8 trades:")
    for _, r in top5.iterrows():
        print(f"  {str(r.bar_date)[:10]}  {r.strategy:<38}  {r.side:<5}  "
              f"entry={r.entry:>8,.0f}  bars={r.bars_held:>3}  {r.result:<7}  net={r.net_r:>+5.2f}R")
    print("\nBottom 8 trades:")
    for _, r in bot5.iterrows():
        print(f"  {str(r.bar_date)[:10]}  {r.strategy:<38}  {r.side:<5}  "
              f"entry={r.entry:>8,.0f}  bars={r.bars_held:>3}  {r.result:<7}  net={r.net_r:>+5.2f}R")

    print(f"\n{'='*70}")
    print(f"Total portfolio over 8 years: {df['net_r'].sum():+.1f}R  |  "
          f"WR={len(wins)/len(df)*100:.1f}%  |  avg/trade={df['net_r'].mean():+.3f}R")
    print(f"Fee drag total: {df['fee_r'].sum():.1f}R  ({df['fee_r'].sum()/df['raw_r'].sum()*100:.0f}% of gross profit eaten by fees)")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
