"""
AlphaBrain v1 -- Full Backtest with Out-of-Sample Validation

Training : 2017-01-01 -> 2021-12-31
Testing  : 2022-01-01 -> 2026-04-01

Exit logic:
  - TP at Goal 1 (100% exit, no partials in v1)
  - SL at 0.8% beyond level
  - Time stop: 30 × 4H bars = 5 days
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pandas as pd
import numpy as np
from collections import defaultdict

from signal_engine.brain.key_levels import calculate_key_levels, get_nearest_levels
from signal_engine.brain.fibonacci import calculate_targets
from signal_engine.brain.reaction_detector import _is_rejection_candle, SIGNAL_LEVELS
from signal_engine.brain.brain_config import (
    LEVEL_TOUCH_THRESHOLD, REJECTION_CLOSE_PCT, MIN_WICK_RATIO,
    SL_BEYOND_LEVEL, LEVEL_MAX_DISTANCE, TIME_STOP_BARS,
    BRAIN_RISK_PCT
)

BASE = r"C:\Users\zamir\OneDrive\Claude AI\btc-data"

# ── Load data once ────────────────────────────────────────────────────────────

def load_data():
    def prep(path):
        df = pd.read_parquet(path)
        if 'datetime' in df.columns:
            df.index = pd.to_datetime(df['datetime'], utc=True)
            df = df.drop(columns=['datetime'])
        elif df.index.tz is None:
            df.index = df.index.tz_localize('UTC')
        return df

    return (
        prep(f"{BASE}/btcusdt_1h.parquet"),
        prep(f"{BASE}/btcusdt_4h.parquet"),
        prep(f"{BASE}/btcusdt_1d.parquet"),
        prep(f"{BASE}/btcusdt_1w.parquet"),
        prep(f"{BASE}/btcusdt_1M.parquet"),
    )


# ── Signal scanner (candle-by-candle) ────────────────────────────────────────

ATR_THRESHOLD = 0.012   # 1.2% — above this, skip signal (too volatile for 0.8% SL)
ATR_PERIOD    = 14


def _bias(open_price, current_price, threshold):
    if open_price <= 0:
        return 'NEUTRAL'
    r = (current_price - open_price) / open_price
    return 'BULL' if r > threshold else ('BEAR' if r < -threshold else 'NEUTRAL')


def _macro_biases(dd, current_price, ts):
    """Return (yearly, quarterly, monthly) bias tuple."""
    yr = ts.year
    yr_data = dd[dd.index.year == yr]
    yr_open = float(yr_data['close'].iloc[0]) if len(yr_data) else current_price

    q_month = {1:1, 2:4, 3:7, 4:10}[(ts.month - 1) // 3 + 1]
    q_start = pd.Timestamp(yr, q_month, 1, tz='UTC')
    q_data  = dd[dd.index >= q_start]
    q_open  = float(q_data['close'].iloc[0]) if len(q_data) else current_price

    m_start = pd.Timestamp(yr, ts.month, 1, tz='UTC')
    m_data  = dd[dd.index >= m_start]
    m_open  = float(m_data['close'].iloc[0]) if len(m_data) else current_price

    return (
        _bias(yr_open, current_price, 0.03),
        _bias(q_open,  current_price, 0.03),
        _bias(m_open,  current_price, 0.02),
    )


def _atr_pct(d4, current_price):
    """ATR(14) on 4H as % of current price. Returns None if insufficient data."""
    tail = d4.tail(ATR_PERIOD + 1)
    if len(tail) < ATR_PERIOD + 1:
        return None
    highs  = tail['high'].values.astype(float)
    lows   = tail['low'].values.astype(float)
    closes = tail['close'].values.astype(float)
    trs = []
    for i in range(1, len(tail)):
        tr = max(highs[i] - lows[i],
                 abs(highs[i] - closes[i-1]),
                 abs(lows[i]  - closes[i-1]))
        trs.append(tr)
    atr = np.mean(trs)
    return atr / current_price if current_price > 0 else None


def scan_signals(df1, df4, dfd, dfw, dfm, start, end):
    """
    Walk through every 4H candle in [start, end).
    v3 changes:
      - Cascading macro filter (all-three biases must align to block)
      - prev_month_low excluded via SIGNAL_LEVELS
      - ATR gate: skip if 4H ATR > 1.2% of price
      - SL reverted to 0.8%

    Returns (signals, macro_blocked, vol_blocked, vol_blocked_trades).
    vol_blocked_trades carries the hypothetical outcome list for Q4 analysis.
    """
    start = pd.Timestamp(start, tz='UTC')
    end   = pd.Timestamp(end,   tz='UTC')

    candles = df4[(df4.index >= start) & (df4.index < end)]
    signals       = []
    macro_blocked = 0
    vol_blocked   = 0
    vol_blocked_candidates = []   # signals that passed all checks except ATR
    last_signal_ts = None
    COOLDOWN = pd.Timedelta(hours=5 * 4)

    for ts, row in candles.iterrows():
        d1 = df1[df1.index <= ts]
        d4 = df4[df4.index <= ts]
        dd = dfd[dfd.index <= ts]
        dw = dfw[dfw.index <= ts]
        dm = dfm[dfm.index <= ts]

        if len(d1) < 24 or len(dd) < 30:
            continue

        current_price = float(d1['close'].iloc[-1])

        try:
            levels, _ = calculate_key_levels(d1, d4, dd, dw, dm, as_of=ts)
        except Exception:
            continue

        if last_signal_ts and (ts - last_signal_ts) < COOLDOWN:
            continue

        # v3 cascading macro biases
        yr_bias, q_bias, m_bias = _macro_biases(dd, current_price, ts)

        # ATR gate (computed once per candle, before level loop)
        atr_pct = _atr_pct(d4, current_price)

        pw_high = levels.get('prev_week_high', {}).get('price')
        pw_low  = levels.get('prev_week_low',  {}).get('price')
        ref_range = (pw_high - pw_low) if (pw_high and pw_low) else current_price * 0.05

        nearby = get_nearest_levels(levels, current_price, max_distance_pct=LEVEL_MAX_DISTANCE)
        nearby = [n for n in nearby if n['name'] in SIGNAL_LEVELS]

        for level_info in nearby:
            lname  = level_info['name']
            lprice = level_info['price']

            if lname == 'all_time_high':
                is_sup, is_res = False, True
            elif lname == 'cycle_low':
                is_sup, is_res = True, False
            elif level_info['level_type'] == 'prior_high':
                is_sup, is_res = False, True
            elif level_info['level_type'] == 'prior_low':
                is_sup, is_res = True, False
            else:
                continue

            for direction, is_valid in [('LONG', is_sup), ('SHORT', is_res)]:
                if not is_valid:
                    continue

                # v3 cascading macro filter
                if direction == 'LONG':
                    all_bear = (yr_bias == 'BEAR' and q_bias == 'BEAR' and m_bias == 'BEAR')
                    if all_bear:
                        macro_blocked += 1
                        continue
                else:  # SHORT
                    all_bull = (yr_bias == 'BULL' and q_bias == 'BULL' and m_bias == 'BULL')
                    if all_bull:
                        macro_blocked += 1
                        continue

                # Touch check
                if direction == 'LONG':
                    touched = (row['low'] <= lprice * (1 + LEVEL_TOUCH_THRESHOLD) and
                               row['low'] >= lprice * (1 - LEVEL_TOUCH_THRESHOLD * 3))
                else:
                    touched = (row['high'] >= lprice * (1 - LEVEL_TOUCH_THRESHOLD) and
                               row['high'] <= lprice * (1 + LEVEL_TOUCH_THRESHOLD * 3))

                if not touched:
                    continue

                if not _is_rejection_candle(row, direction):
                    continue

                entry = float(row['close'])
                sl    = lprice * (1 - SL_BEYOND_LEVEL) if direction == 'LONG' \
                        else lprice * (1 + SL_BEYOND_LEVEL)
                targets = calculate_targets(lprice, direction, ref_range)
                risk = abs(entry - sl)
                rr1  = abs(targets['goal_1'] - entry) / risk if risk > 0 else 0

                candidate = {
                    'ts':          ts,
                    'direction':   direction,
                    'level_type':  lname,
                    'level_price': round(lprice, 2),
                    'entry':       round(entry, 2),
                    'sl':          round(sl, 2),
                    'goal_1':      targets['goal_1'],
                    'ref_range':   round(ref_range, 2),
                    'rr_goal1':    round(rr1, 2),
                    'yr_bias':     yr_bias,
                    'q_bias':      q_bias,
                    'm_bias':      m_bias,
                    'atr_pct':     round(atr_pct * 100, 3) if atr_pct else None,
                }

                # v3 ATR gate
                if atr_pct is not None and atr_pct > ATR_THRESHOLD:
                    vol_blocked += 1
                    vol_blocked_candidates.append(candidate)
                    continue

                signals.append(candidate)
                last_signal_ts = ts
                break

    return signals, macro_blocked, vol_blocked, vol_blocked_candidates


# ── Trade simulator ───────────────────────────────────────────────────────────

def simulate_trades(signals, df4, initial_equity=10_000):
    """
    For each signal, find the exit on subsequent 4H candles.
    Returns list of closed trade dicts.
    """
    trades = []
    equity = initial_equity

    for sig in signals:
        entry    = sig['entry']
        sl       = sig['sl']
        goal_1   = sig['goal_1']
        direction = sig['direction']

        # 4H candles AFTER the signal candle
        future = df4[df4.index > sig['ts']].head(TIME_STOP_BARS)
        if len(future) == 0:
            continue

        exit_price  = None
        exit_reason = None
        bars_held   = 0

        for i, (fts, frow) in enumerate(future.iterrows()):
            bars_held = i + 1
            lo, hi = float(frow['low']), float(frow['high'])

            if direction == 'LONG':
                if lo <= sl:
                    exit_price  = sl
                    exit_reason = 'SL'
                    break
                if hi >= goal_1:
                    exit_price  = goal_1
                    exit_reason = 'TP1'
                    break
            else:  # SHORT
                if hi >= sl:
                    exit_price  = sl
                    exit_reason = 'SL'
                    break
                if lo <= goal_1:
                    exit_price  = goal_1
                    exit_reason = 'TP1'
                    break

        if exit_price is None:
            exit_price  = float(future['close'].iloc[-1])
            exit_reason = 'TIME'

        risk_usd  = equity * BRAIN_RISK_PCT
        risk_per_unit = abs(entry - sl)
        if risk_per_unit <= 0:
            continue

        position_size = risk_usd / risk_per_unit   # BTC units

        if direction == 'LONG':
            pnl = (exit_price - entry) * position_size
        else:
            pnl = (entry - exit_price) * position_size

        r_multiple = (exit_price - entry) / risk_per_unit if direction == 'LONG' \
                     else (entry - exit_price) / risk_per_unit

        equity += pnl

        trades.append({
            **sig,
            'exit_price':  round(exit_price, 2),
            'exit_reason': exit_reason,
            'bars_held':   bars_held,
            'pnl':         round(pnl, 2),
            'r_multiple':  round(r_multiple, 3),
            'equity_after': round(equity, 2),
        })

    return trades, equity


# ── Metrics calculator ────────────────────────────────────────────────────────

def calc_metrics(trades, initial_equity=10_000):
    if not trades:
        return {}

    df = pd.DataFrame(trades)
    n  = len(df)
    wins = df[df['r_multiple'] > 0]
    wr   = len(wins) / n * 100

    avg_r  = df['r_multiple'].mean()
    total_r = df['r_multiple'].sum()

    # CAGR
    equity_series = [initial_equity] + list(df['equity_after'])
    first_ts = df['ts'].iloc[0]
    last_ts  = df['ts'].iloc[-1]
    years    = (last_ts - first_ts).total_seconds() / (365.25 * 86400)
    if years > 0:
        cagr = ((equity_series[-1] / initial_equity) ** (1 / years) - 1) * 100
    else:
        cagr = 0.0

    # Max drawdown
    eq = np.array(equity_series)
    peak = np.maximum.accumulate(eq)
    dd   = (eq - peak) / peak * 100
    max_dd = float(dd.min())

    # By level type
    by_level = {}
    for ltype, grp in df.groupby('level_type'):
        ln  = len(grp)
        lwr = (grp['r_multiple'] > 0).sum() / ln * 100
        lar = grp['r_multiple'].mean()
        by_level[ltype] = {'n': ln, 'wr': round(lwr, 1), 'avg_r': round(lar, 3)}

    # Exit reason breakdown
    exit_counts = df['exit_reason'].value_counts().to_dict()

    return {
        'n_trades':   n,
        'win_rate':   round(wr, 1),
        'avg_r':      round(avg_r, 3),
        'total_r':    round(total_r, 2),
        'final_equity': round(equity_series[-1], 2),
        'cagr':       round(cagr, 2),
        'max_dd':     round(max_dd, 2),
        'calmar':     round(abs(cagr / max_dd), 3) if max_dd != 0 else 0,
        'by_level':   by_level,
        'exit_counts': exit_counts,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def print_metrics(label, m, by_level_combined=None):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    if not m:
        print("  No trades.")
        return
    print(f"  Trades    : {m['n_trades']}")
    print(f"  Win rate  : {m['win_rate']}%")
    print(f"  Avg R     : {m['avg_r']:+.3f}")
    print(f"  Total R   : {m['total_r']:+.1f}R")
    print(f"  Final eq  : ${m['final_equity']:,.0f}")
    print(f"  CAGR      : {m['cagr']:+.1f}%")
    print(f"  Max DD    : {m['max_dd']:.1f}%")
    print(f"  Calmar    : {m['calmar']:.3f}")
    print(f"  Exits     : {m['exit_counts']}")

    print(f"\n  {'Level':<22} {'N':>4} {'WR%':>6} {'AvgR':>7}  Worth?")
    print(f"  {'-'*55}")
    for lname, stats in sorted(m['by_level'].items(),
                                key=lambda x: -x[1]['avg_r']):
        worth = 'YES' if stats['avg_r'] > 0.1 and stats['wr'] >= 40 and stats['n'] >= 3 \
                else ('MAYBE' if stats['avg_r'] > 0 else 'NO')
        print(f"  {lname:<22} {stats['n']:>4} {stats['wr']:>6.1f}% {stats['avg_r']:>+7.3f}  {worth}")


def print_combined_table(train_m, test_m):
    print(f"\n{'='*60}")
    print("  COMBINED RESULTS TABLE")
    print(f"{'='*60}")
    print(f"  {'Metric':<20} {'Training':>12} {'Testing':>12} {'Degradation':>13}")
    print(f"  {'-'*58}")

    def row(label, t_val, s_val, fmt='.1f', pct=False):
        if pct and t_val != 0:
            deg = (s_val - t_val) / abs(t_val) * 100
            deg_str = f"{deg:+.1f}%"
        else:
            deg_str = "--"
        t_str = format(t_val, fmt)
        s_str = format(s_val, fmt)
        print(f"  {label:<20} {t_str:>12} {s_str:>12} {deg_str:>13}")

    if train_m and test_m:
        row("Trades",     train_m['n_trades'],   test_m['n_trades'],   fmt='d')
        row("Win Rate %", train_m['win_rate'],    test_m['win_rate'],   pct=True)
        row("Avg R",      train_m['avg_r'],       test_m['avg_r'],      fmt='+.3f', pct=True)
        row("CAGR %",     train_m['cagr'],        test_m['cagr'],       fmt='+.1f', pct=True)
        row("Max DD %",   train_m['max_dd'],      test_m['max_dd'],     fmt='.1f')
        row("Calmar",     train_m['calmar'],      test_m['calmar'],     fmt='.3f')

        wr_deg = (test_m['win_rate'] - train_m['win_rate']) / abs(train_m['win_rate']) * 100 \
                  if train_m['win_rate'] else 0
        print(f"\n  Win Rate degradation: {wr_deg:+.1f}%")
        if abs(wr_deg) < 15:
            verdict = "ROBUST -- degradation < 15%, signal appears genuine"
        elif abs(wr_deg) < 30:
            verdict = "MARGINAL -- degradation 15-30%, proceed with caution"
        else:
            verdict = "LIKELY OVERFIT -- degradation > 30%, do not deploy"
        print(f"  Verdict: {verdict}")


def print_level_breakdown(all_trades):
    """Combined level breakdown across all periods."""
    if not all_trades:
        return
    df = pd.DataFrame(all_trades)
    print(f"\n{'='*60}")
    print("  LEVEL BREAKDOWN -- ALL PERIODS COMBINED")
    print(f"{'='*60}")
    print(f"  {'Level':<22} {'N':>4} {'WR%':>6} {'AvgR':>7} {'TotR':>7}  Worth keeping?")
    print(f"  {'-'*65}")
    for lname, grp in sorted(df.groupby('level_type'),
                              key=lambda x: -x[1]['r_multiple'].mean()):
        n   = len(grp)
        wr  = (grp['r_multiple'] > 0).sum() / n * 100
        ar  = grp['r_multiple'].mean()
        tr  = grp['r_multiple'].sum()
        worth = 'YES' if ar > 0.15 and wr >= 40 and n >= 4 \
                else ('MAYBE' if ar > 0 and n >= 2 else 'NO')
        print(f"  {lname:<22} {n:>4} {wr:>6.1f}% {ar:>+7.3f} {tr:>+7.2f}  {worth}")


def print_v1_v2_comparison(v1, v2, label):
    """Side-by-side v1 vs v2 for one period."""
    print(f"\n{'='*68}")
    print(f"  {label}")
    print(f"{'='*68}")
    if not v1 or not v2:
        print("  (insufficient data)")
        return
    print(f"  {'Metric':<18} {'v1':>10} {'v2':>10} {'Delta':>10}")
    print(f"  {'-'*50}")

    def drow(name, k, fmt='.1f', sign=False):
        a, b = v1.get(k, 0), v2.get(k, 0)
        d = b - a
        a_s = format(a, ('+' if sign else '') + fmt)
        b_s = format(b, ('+' if sign else '') + fmt)
        d_s = format(d, '+' + fmt)
        print(f"  {name:<18} {a_s:>10} {b_s:>10} {d_s:>10}")

    drow("Trades",    'n_trades', fmt='d')
    drow("Win Rate %",'win_rate', fmt='.1f')
    drow("Avg R",     'avg_r',    fmt='.3f', sign=True)
    drow("Total R",   'total_r',  fmt='.1f', sign=True)
    drow("CAGR %",    'cagr',     fmt='.1f', sign=True)
    drow("Max DD %",  'max_dd',   fmt='.1f')
    drow("Calmar",    'calmar',   fmt='.3f')


def print_weekly_only(all_trades, initial_equity=10_000):
    """Analyse prev_week_high and prev_week_low in isolation."""
    wk = [t for t in all_trades if t['level_type'] in ('prev_week_high', 'prev_week_low')]
    if not wk:
        print("\n  (no weekly level trades)")
        return
    df = pd.DataFrame(wk)
    n   = len(df)
    wr  = (df['r_multiple'] > 0).sum() / n * 100
    ar  = df['r_multiple'].mean()
    tr  = df['r_multiple'].sum()

    # Date span
    first_ts = df['ts'].iloc[0]
    last_ts  = df['ts'].iloc[-1]
    years = (last_ts - first_ts).total_seconds() / (365.25 * 86400)
    trades_per_yr = n / years if years > 0 else 0

    # Equity curve for weekly-only trades
    eq = initial_equity
    eq_series = [eq]
    for _, row in df.iterrows():
        risk_usd = eq * BRAIN_RISK_PCT
        risk_pu  = abs(row['entry'] - row['sl'])
        if risk_pu <= 0:
            continue
        pos  = risk_usd / risk_pu
        pnl  = (row['exit_price'] - row['entry']) * pos if row['direction'] == 'LONG' \
               else (row['entry'] - row['exit_price']) * pos
        eq  += pnl
        eq_series.append(eq)

    eq_arr = np.array(eq_series)
    peak   = np.maximum.accumulate(eq_arr)
    dd_arr = (eq_arr - peak) / peak * 100
    max_dd = float(dd_arr.min())
    cagr   = ((eq_series[-1] / initial_equity) ** (1 / years) - 1) * 100 if years > 0 else 0

    print(f"\n{'='*60}")
    print("  WEEKLY LEVELS ONLY (prev_week_high + prev_week_low)")
    print(f"{'='*60}")
    print(f"  Trades total    : {n}")
    print(f"  Trades per year : {trades_per_yr:.1f}")
    print(f"  Win rate        : {wr:.1f}%")
    print(f"  Avg R           : {ar:+.3f}")
    print(f"  Total R         : {tr:+.1f}R")
    print(f"  CAGR            : {cagr:+.1f}%")
    print(f"  Max DD          : {max_dd:.1f}%")
    print()
    print(f"  {'Level':<22} {'N':>4} {'WR%':>6} {'AvgR':>7}")
    print(f"  {'-'*42}")
    for lname, grp in df.groupby('level_type'):
        ln  = len(grp)
        lwr = (grp['r_multiple'] > 0).sum() / ln * 100
        lar = grp['r_multiple'].mean()
        print(f"  {lname:<22} {ln:>4} {lwr:>6.1f}% {lar:>+7.3f}")


if __name__ == '__main__':
    print("Loading BTC data...")
    df1, df4, dfd, dfw, dfm = load_data()
    print(f"  1H: {df1.index[0].date()} -> {df1.index[-1].date()}  ({len(df1):,} rows)")
    print(f"  4H: {df4.index[0].date()} -> {df4.index[-1].date()}  ({len(df4):,} rows)")

    INITIAL_EQUITY = 10_000

    # v1 and v2 results (hardcoded from prior runs)
    V1_TRAIN = {'n_trades':81,  'win_rate':13.6, 'avg_r':-0.490, 'total_r':-39.7,
                'cagr':-26.4, 'max_dd':-76.0, 'calmar':0.347,
                'exit_counts':{'SL':69,'TP1':10,'TIME':2}, 'by_level':{}}
    V1_TEST  = {'n_trades':169, 'win_rate':26.6, 'avg_r':+0.083, 'total_r':+14.0,
                'cagr':+3.1,  'max_dd':-46.1, 'calmar':0.067,
                'exit_counts':{'SL':122,'TP1':38,'TIME':9}, 'by_level':{}}
    V2_TRAIN = {'n_trades':9,  'win_rate':33.3, 'avg_r':+0.569, 'total_r':+5.1,
                'cagr':+3.5,  'max_dd':-11.5, 'calmar':0.310,
                'exit_counts':{'SL':6,'TP1':3}, 'by_level':{}}
    V2_TEST  = {'n_trades':23, 'win_rate':30.4, 'avg_r':-0.143, 'total_r':-3.3,
                'cagr':-3.2,  'max_dd':-21.9, 'calmar':0.147,
                'exit_counts':{'SL':16,'TP1':6,'TIME':1}, 'by_level':{}}

    # ── TRAINING 2017-2021 ────────────────────────────────────────────────────
    print("\nScanning TRAINING period (2017-01-01 -> 2021-12-31)...")
    train_sigs, train_macro, train_vol, train_vol_cands = scan_signals(
        df1, df4, dfd, dfw, dfm, '2017-01-01', '2022-01-01')
    print(f"  Signals: {len(train_sigs)}  macro-blocked: {train_macro}  vol-blocked: {train_vol}")
    train_trades, _ = simulate_trades(train_sigs, df4, INITIAL_EQUITY)
    train_m = calc_metrics(train_trades, INITIAL_EQUITY)

    # ── TESTING 2022-2026 ─────────────────────────────────────────────────────
    print("\nScanning TESTING period (2022-01-01 -> 2026-04-01)...")
    test_sigs, test_macro, test_vol, test_vol_cands = scan_signals(
        df1, df4, dfd, dfw, dfm, '2022-01-01', '2026-04-01')
    print(f"  Signals: {len(test_sigs)}  macro-blocked: {test_macro}  vol-blocked: {test_vol}")
    test_trades, _ = simulate_trades(test_sigs, df4, INITIAL_EQUITY)
    test_m = calc_metrics(test_trades, INITIAL_EQUITY)

    all_trades    = train_trades + test_trades
    total_macro   = train_macro + test_macro
    total_vol     = train_vol   + test_vol
    all_vol_cands = train_vol_cands + test_vol_cands

    # ── RESULTS ───────────────────────────────────────────────────────────────
    print_metrics("v3 TRAINING -- 2017-2021", train_m)
    print_metrics("v3 TESTING  -- 2022-2026", test_m)

    # v1 / v2 / v3 three-way table
    print(f"\n{'='*72}")
    print("  v1 vs v2 vs v3 -- TRAINING (2017-2021)")
    print(f"{'='*72}")
    print(f"  {'Metric':<18} {'v1':>9} {'v2':>9} {'v3':>9} {'v2->v3':>9}")
    print(f"  {'-'*58}")
    def trow(name, k, fmt='.1f', sign=False):
        vals = [V1_TRAIN, V2_TRAIN, train_m]
        fs = ('+' if sign else '') + fmt
        a,b,c = [v.get(k,0) for v in vals]
        d = c - b
        print(f"  {name:<18} {format(a,fs):>9} {format(b,fs):>9} "
              f"{format(c,fs):>9} {format(d,'+'+fmt):>9}")
    trow("Trades",    'n_trades', fmt='d')
    trow("Win Rate %",'win_rate')
    trow("Avg R",     'avg_r', fmt='.3f', sign=True)
    trow("CAGR %",    'cagr',  sign=True)
    trow("Max DD %",  'max_dd')
    trow("Calmar",    'calmar', fmt='.3f')

    print(f"\n{'='*72}")
    print("  v1 vs v2 vs v3 -- TESTING  (2022-2026)")
    print(f"{'='*72}")
    print(f"  {'Metric':<18} {'v1':>9} {'v2':>9} {'v3':>9} {'v2->v3':>9}")
    print(f"  {'-'*58}")
    def trow2(name, k, fmt='.1f', sign=False):
        vals = [V1_TEST, V2_TEST, test_m]
        fs = ('+' if sign else '') + fmt
        a,b,c = [v.get(k,0) for v in vals]
        d = c - b
        print(f"  {name:<18} {format(a,fs):>9} {format(b,fs):>9} "
              f"{format(c,fs):>9} {format(d,'+'+fmt):>9}")
    trow2("Trades",    'n_trades', fmt='d')
    trow2("Win Rate %",'win_rate')
    trow2("Avg R",     'avg_r', fmt='.3f', sign=True)
    trow2("CAGR %",    'cagr',  sign=True)
    trow2("Max DD %",  'max_dd')
    trow2("Calmar",    'calmar', fmt='.3f')

    print_combined_table(train_m, test_m)
    print_level_breakdown(all_trades)
    print_weekly_only(all_trades, INITIAL_EQUITY)

    # ── 6 SPECIFIC QUESTIONS ──────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  ANSWERS TO 6 QUESTIONS")
    print(f"{'='*60}")

    print(f"  1. Total trades in v3: {len(all_trades)}  (v1=250, v2=32)")

    print(f"  2. Macro-blocked: {total_macro} (v2 blocked 143)")
    print(f"     Training: {train_macro}  Testing: {test_macro}")
    print(f"     Vol-blocked (ATR gate): {total_vol}")
    print(f"     Training: {train_vol}  Testing: {test_vol}")

    pwl = [t for t in all_trades if t['level_type'] == 'prev_week_low']
    if pwl:
        pwl_wr = sum(1 for t in pwl if t['r_multiple'] > 0) / len(pwl) * 100
        held = "YES" if pwl_wr >= 50 else "NO"
        print(f"  3. prev_week_low WR: {pwl_wr:.1f}% ({len(pwl)} trades) -- above 50%? {held}")
    else:
        print("  3. prev_week_low: no trades")

    # Q4: WR of vol-blocked vs allowed
    if all_vol_cands:
        vol_blocked_trades, _ = simulate_trades(all_vol_cands, df4, INITIAL_EQUITY)
        if vol_blocked_trades:
            vb_wr = sum(1 for t in vol_blocked_trades if t['r_multiple'] > 0) / len(vol_blocked_trades) * 100
            vb_ar = sum(t['r_multiple'] for t in vol_blocked_trades) / len(vol_blocked_trades)
        else:
            vb_wr, vb_ar = 0, 0
        allowed_wr = sum(1 for t in all_trades if t['r_multiple'] > 0) / len(all_trades) * 100 if all_trades else 0
        allowed_ar = sum(t['r_multiple'] for t in all_trades) / len(all_trades) if all_trades else 0
        verdict = "removed bad" if vb_wr < allowed_wr else "removed good"
        print(f"  4. ATR gate quality check:")
        print(f"     Allowed  : {len(all_trades)} trades  WR={allowed_wr:.1f}%  AvgR={allowed_ar:+.3f}")
        print(f"     Blocked  : {len(vol_blocked_trades)} trades  WR={vb_wr:.1f}%  AvgR={vb_ar:+.3f}  -> {verdict}")
    else:
        print("  4. No vol-blocked candidates to analyse")

    print(f"  5. Testing period CAGR: {test_m.get('cagr',0):+.1f}%  (v1=+3.1%  v2=-3.2%)")

    wk_only = [t for t in all_trades if t['level_type'] in ('prev_week_high','prev_week_low')]
    if wk_only:
        df_wk = pd.DataFrame(wk_only)
        wk_wr = (df_wk['r_multiple'] > 0).sum() / len(df_wk) * 100
        wk_ar = df_wk['r_multiple'].mean()
        # Quick CAGR estimate for weekly-only (reusing equity from print_weekly_only)
        first_ts = df_wk['ts'].iloc[0]; last_ts = df_wk['ts'].iloc[-1]
        yrs = (last_ts - first_ts).total_seconds() / (365.25*86400)
        eq = INITIAL_EQUITY
        for _, r in df_wk.iterrows():
            risk_usd = eq * BRAIN_RISK_PCT
            rpu = abs(r['entry'] - r['sl'])
            if rpu <= 0: continue
            pnl = (r['exit_price'] - r['entry']) * (risk_usd/rpu) if r['direction']=='LONG' \
                  else (r['entry'] - r['exit_price']) * (risk_usd/rpu)
            eq += pnl
        wk_cagr = ((eq / INITIAL_EQUITY)**(1/yrs) - 1)*100 if yrs > 0 else 0
        print(f"  6. Weekly-levels-only CAGR: {wk_cagr:+.1f}%  "
              f"({len(wk_only)} trades, WR={wk_wr:.1f}%, AvgR={wk_ar:+.3f})")
    else:
        print("  6. No weekly level trades")

    # ── SAVE ─────────────────────────────────────────────────────────────────
    if all_trades:
        out = os.path.join(os.path.dirname(__file__), '..', 'trades_brain_v3.csv')
        pd.DataFrame(all_trades).to_csv(out, index=False)
        print(f"\nTrades saved to trades_brain_v3.csv ({len(all_trades)} rows)")
