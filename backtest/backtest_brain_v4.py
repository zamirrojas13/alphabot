"""
AlphaBrain v4 -- Level Lifecycle Backtest
2017-08-17 to 2026-04-24 on 1H BTC data.

Architecture:
  - Levels persist as WATCHING until price arrives (0.8%)
  - Arrival -> CONFIRMING, scan 1H for rejection confirmation
  - Confirmation -> TRADE OPEN
  - Price closes 1.5% through level -> DENIED
  - Price retreats 2% from CONFIRMING level -> reset to WATCHING

Exit logic (3-tier):
  G1: move SL to breakeven, hold full position
  G2: exit 50%, move SL to G1
  G3: exit remaining 50%
  SL before G1: -1R full loss
  Time stop: 240 1H bars (10 days)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pandas as pd
import numpy as np
from collections import defaultdict

BASE = r"C:\Users\zamir\OneDrive\Claude AI\btc-data"

ARRIVAL_PCT   = 0.008    # 0.8%  -- WATCHING -> CONFIRMING
DENIAL_PCT    = 0.015    # 1.5%  -- close through = DENIED
RETREAT_PCT   = 0.020    # 2.0%  -- reset CONFIRMING -> WATCHING
TOUCH_BAND    = 0.005    # 0.5%  -- 1H candle must touch within this
CLOSE_POS     = 0.65     # top/bottom 35% = 65% from the far side
WICK_RATIO    = 2.0
VOL_MULT      = 1.2      # volume > 1.2x 20-bar avg
SL_PCT        = 0.008    # 0.8% beyond level
GOAL_MULTS    = (0.5, 1.0, 1.5)
TIME_STOP     = 240      # 1H bars = 10 days
BRAIN_RISK    = 0.025    # 2.5% per trade
DEDUP_TOL     = 0.005    # 0.5% -- don't add duplicate level
INITIAL_EQ    = 10_000

LEVEL_DIRS = {
    'prev_week_high': 'RESISTANCE', 'prev_week_low': 'SUPPORT',
    'prev_month_high': 'RESISTANCE', 'prev_month_low': 'SUPPORT',
    'prev_quarter_high': 'RESISTANCE', 'prev_quarter_low': 'SUPPORT',
    'prev_year_high': 'RESISTANCE', 'prev_year_low': 'SUPPORT',
}
PREFIX = {
    'prev_week_high': 'PWH', 'prev_week_low': 'PWL',
    'prev_month_high': 'PMH', 'prev_month_low': 'PML',
    'prev_quarter_high': 'PQH', 'prev_quarter_low': 'PQL',
    'prev_year_high': 'PYH', 'prev_year_low': 'PYL',
}


# ── Data loading ──────────────────────────────────────────────────────────────

def load_1h():
    df = pd.read_parquet(f"{BASE}/btcusdt_1h.parquet")
    if 'datetime' in df.columns:
        df.index = pd.to_datetime(df['datetime'], utc=True)
        df = df.drop(columns=['datetime'])
    elif df.index.tz is None:
        df.index = df.index.tz_localize('UTC')

    df['vol_ma20'] = df['volume'].rolling(20).mean()
    df['ema9']     = df['close'].ewm(span=9,  adjust=False).mean()
    df['ema21']    = df['close'].ewm(span=21, adjust=False).mean()
    return df


# ── Level helpers ─────────────────────────────────────────────────────────────

def _make_level(ltype, price, date_label, notes=''):
    return {
        'id':        f"{PREFIX[ltype]}-{date_label}",
        'price':     round(float(price), 2),
        'type':      ltype,
        'direction': LEVEL_DIRS[ltype],
        'status':    'WATCHING',
        'date':      date_label,
        'times_tested': 0,
        'confirming_since': None,
        'notes':     notes,
    }


def _exists(levels, price):
    for l in levels:
        if l['status'] in ('WATCHING', 'CONFIRMING'):
            if abs(l['price'] - price) / max(price, 1) <= DEDUP_TOL:
                return True
    return False


def _add(levels, ltype, price, label, notes=''):
    if not _exists(levels, price):
        levels.append(_make_level(ltype, price, label, notes))
        return True
    return False


# ── 1H confirmation check ─────────────────────────────────────────────────────

def _confirm_1h(row, direction, col_streak):
    hi, lo = float(row['high']), float(row['low'])
    op, cl = float(row['open']), float(row['close'])
    rng = hi - lo
    if rng <= 0:
        return False
    body = max(abs(cl - op), 1e-8)

    vol_ma = row.get('vol_ma20', float('nan'))
    if pd.isna(vol_ma) or row['volume'] <= VOL_MULT * vol_ma:
        return False

    ema9, ema21 = row.get('ema9'), row.get('ema21')

    if direction == 'SUPPORT':
        top35    = (cl - lo) / rng >= CLOSE_POS
        green    = cl > op
        lo_wick  = max(min(op, cl) - lo, 0)
        big_wick = lo_wick / body >= WICK_RATIO
        candle   = top35 and (green or big_wick)
        ema_ok   = (ema9 is not None and ema21 is not None
                    and not pd.isna(ema9) and not pd.isna(ema21)
                    and ema9 > ema21)
        flip     = col_streak <= -3 and green
        return candle and (ema_ok or flip)
    else:
        bot35    = (hi - cl) / rng >= CLOSE_POS
        red      = cl < op
        hi_wick  = max(hi - max(op, cl), 0)
        big_wick = hi_wick / body >= WICK_RATIO
        candle   = bot35 and (red or big_wick)
        ema_ok   = (ema9 is not None and ema21 is not None
                    and not pd.isna(ema9) and not pd.isna(ema21)
                    and ema9 < ema21)
        flip     = col_streak >= 3 and red
        return candle and (ema_ok or flip)


# ── Exit checker ──────────────────────────────────────────────────────────────

def _check_exits(trade, hi, lo, cl):
    """
    Update trade state for one 1H candle.
    Returns (closed: bool, final_r: float or None, exit_reason: str or None)
    """
    direction = trade['direction']
    sl  = trade['sl_current']
    g1, g2, g3 = trade['g1'], trade['g2'], trade['g3']
    risk = trade['risk']

    if direction == 'LONG':
        # SL first (conservative)
        if lo <= sl:
            if not trade['g1_hit']:
                r = trade['pnl_r'] + trade['size'] * (-1.0)
            else:
                r = trade['pnl_r'] + trade['size'] * ((sl - trade['entry']) / risk)
            return True, round(r, 4), 'SL'

        if not trade['g1_hit'] and hi >= g1:
            trade['g1_hit']     = True
            trade['sl_current'] = trade['entry']   # move to BE

        if trade['g1_hit'] and not trade['g2_hit'] and hi >= g2:
            trade['g2_hit'] = True
            r_g2 = trade['size'] * 0.5 * ((g2 - trade['entry']) / risk)
            trade['pnl_r'] += r_g2
            trade['size'] *= 0.5
            trade['sl_current'] = g1              # SL to G1

        if trade['g2_hit'] and hi >= g3:
            r_g3 = trade['size'] * ((g3 - trade['entry']) / risk)
            return True, round(trade['pnl_r'] + r_g3, 4), 'G3'

    else:  # SHORT
        if hi >= sl:
            if not trade['g1_hit']:
                r = trade['pnl_r'] + trade['size'] * (-1.0)
            else:
                r = trade['pnl_r'] + trade['size'] * ((trade['entry'] - sl) / risk)
            return True, round(r, 4), 'SL'

        if not trade['g1_hit'] and lo <= g1:
            trade['g1_hit']     = True
            trade['sl_current'] = trade['entry']

        if trade['g1_hit'] and not trade['g2_hit'] and lo <= g2:
            trade['g2_hit'] = True
            r_g2 = trade['size'] * 0.5 * ((trade['entry'] - g2) / risk)
            trade['pnl_r'] += r_g2
            trade['size'] *= 0.5
            trade['sl_current'] = g1

        if trade['g2_hit'] and lo <= g3:
            r_g3 = trade['size'] * ((trade['entry'] - g3) / risk)
            return True, round(trade['pnl_r'] + r_g3, 4), 'G3'

    return False, None, None


# ── Main simulation ───────────────────────────────────────────────────────────

def run_backtest(df):
    levels       = []
    open_trade   = None
    closed       = []
    denied_log   = []          # (price, type, ts)
    signals_log  = []          # all fired signals for per-year table
    equity       = INITIAL_EQ
    equity_curve = [INITIAL_EQ]

    # Period boundary tracking
    prev_ts      = None
    pw_start     = None        # prior week window start
    pm_start     = None        # prior month window start
    pq_start     = None
    py_start     = None
    prev_week_range = None     # H-L of last completed week

    # Color streak for EMA-flip condition
    col_streak = 0             # positive = green streak, negative = red streak

    total_rows = len(df)
    report_every = total_rows // 10

    print(f"  Simulating {total_rows:,} 1H candles...")

    for i, (ts, row) in enumerate(df.iterrows()):
        if i % report_every == 0:
            pct = i / total_rows * 100
            print(f"    {pct:5.1f}%  levels={len([l for l in levels if l['status'] in ('WATCHING','CONFIRMING')])}  "
                  f"closed={len(closed)}", flush=True)

        cl = float(row['close'])
        hi = float(row['high'])
        lo = float(row['low'])
        op = float(row['open'])

        # Update color streak
        is_green = cl > op
        if is_green:
            col_streak = max(col_streak, 0) + 1
        else:
            col_streak = min(col_streak, 0) - 1

        # ── Period boundaries ─────────────────────────────────────────────────
        if prev_ts is not None:
            iso_wk_changed = (ts.isocalendar()[1] != prev_ts.isocalendar()[1]
                              or ts.year != prev_ts.year)
            if iso_wk_changed and pw_start is not None:
                wk = df[(df.index >= pw_start) & (df.index < ts)]
                if len(wk) >= 20:
                    wh = float(wk['high'].max())
                    wl = float(wk['low'].min())
                    prev_week_range = wh - wl
                    label = ts.strftime('%Y-W%U')
                    _add(levels, 'prev_week_high', wh, label)
                    _add(levels, 'prev_week_low',  wl, label)
                pw_start = ts

            if pm_start is not None and ts.month != prev_ts.month:
                pm = df[(df.index >= pm_start) & (df.index < ts)]
                if len(pm) >= 100:
                    label = prev_ts.strftime('%Y-%m')
                    _add(levels, 'prev_month_high', float(pm['high'].max()), label)
                    _add(levels, 'prev_month_low',  float(pm['low'].min()),  label)
                pm_start = ts

            pq = (ts.month - 1) // 3
            ppq = (prev_ts.month - 1) // 3
            if pq_start is not None and (pq != ppq or ts.year != prev_ts.year):
                pqd = df[(df.index >= pq_start) & (df.index < ts)]
                if len(pqd) >= 300:
                    label = f"{prev_ts.year}-Q{ppq+1}"
                    _add(levels, 'prev_quarter_high', float(pqd['high'].max()), label)
                    _add(levels, 'prev_quarter_low',  float(pqd['low'].min()),  label)
                pq_start = ts

            if py_start is not None and ts.year != prev_ts.year:
                pyd = df[(df.index >= py_start) & (df.index < ts)]
                if len(pyd) >= 1000:
                    label = str(prev_ts.year)
                    _add(levels, 'prev_year_high', float(pyd['high'].max()), label)
                    _add(levels, 'prev_year_low',  float(pyd['low'].min()),  label)
                py_start = ts
        else:
            # First candle -- initialize period windows
            pw_start = ts; pm_start = ts; pq_start = ts; py_start = ts

        # ── WATCHING -> CONFIRMING ────────────────────────────────────────────
        for lvl in levels:
            if lvl['status'] != 'WATCHING':
                continue
            dist = abs(cl - lvl['price']) / lvl['price']
            if dist <= ARRIVAL_PCT:
                lvl['status'] = 'CONFIRMING'
                lvl['confirming_since'] = ts
                lvl['times_tested'] += 1

        # ── CONFIRMING: denial / retreat / confirmation ───────────────────────
        for lvl in levels:
            if lvl['status'] != 'CONFIRMING':
                continue

            lp  = lvl['price']
            ldir = lvl['direction']

            # Denial: 1H close 1.5% through level
            if ldir == 'SUPPORT' and cl < lp * (1 - DENIAL_PCT):
                lvl['status'] = 'DENIED'
                denied_log.append({'price': lp, 'type': lvl['type'], 'ts': ts, 'break': cl})
                continue
            if ldir == 'RESISTANCE' and cl > lp * (1 + DENIAL_PCT):
                lvl['status'] = 'DENIED'
                denied_log.append({'price': lp, 'type': lvl['type'], 'ts': ts, 'break': cl})
                continue

            # Retreat: price moved 2%+ away -> back to WATCHING
            if ldir == 'SUPPORT'    and cl > lp * (1 + RETREAT_PCT):
                lvl['status'] = 'WATCHING'; lvl['confirming_since'] = None; continue
            if ldir == 'RESISTANCE' and cl < lp * (1 - RETREAT_PCT):
                lvl['status'] = 'WATCHING'; lvl['confirming_since'] = None; continue

            # Skip new signals if trade already open
            if open_trade is not None:
                continue

            # Touch check
            if ldir == 'SUPPORT'    and abs(lo - lp) / lp > TOUCH_BAND:
                continue
            if ldir == 'RESISTANCE' and abs(hi - lp) / lp > TOUCH_BAND:
                continue

            # 1H confirmation candle
            if not _confirm_1h(row, ldir, col_streak):
                continue

            # Build trade
            entry = cl
            trade_dir = 'LONG' if ldir == 'SUPPORT' else 'SHORT'
            sl = lp * (1 - SL_PCT) if ldir == 'SUPPORT' else lp * (1 + SL_PCT)
            ref = prev_week_range if prev_week_range else entry * 0.05

            if trade_dir == 'LONG':
                g1 = lp + GOAL_MULTS[0] * ref
                g2 = lp + GOAL_MULTS[1] * ref
                g3 = lp + GOAL_MULTS[2] * ref
            else:
                g1 = lp - GOAL_MULTS[0] * ref
                g2 = lp - GOAL_MULTS[1] * ref
                g3 = lp - GOAL_MULTS[2] * ref

            risk = abs(entry - sl)
            if risk <= 0:
                continue

            open_trade = {
                'entry_ts':  ts,
                'direction': trade_dir,
                'entry':     entry,
                'sl_orig':   sl,
                'sl_current': sl,
                'g1': g1, 'g2': g2, 'g3': g3,
                'risk':      risk,
                'level_type': lvl['type'],
                'level_price': lp,
                'pnl_r':     0.0,
                'size':      1.0,       # 1.0 = full, 0.5 after G2
                'g1_hit':    False,
                'g2_hit':    False,
                'bars':      0,
                'ref_range': ref,
                'equity_at_entry': equity,
            }
            lvl['status'] = 'CONFIRMED'

            signals_log.append({
                'ts': ts, 'direction': trade_dir,
                'level_type': lvl['type'], 'entry': entry,
                'sl': sl, 'g1': g1, 'g2': g2, 'g3': g3,
            })

        # ── Open trade exits ──────────────────────────────────────────────────
        if open_trade is not None:
            open_trade['bars'] += 1
            t = open_trade

            done, final_r, reason = _check_exits(t, hi, lo, cl)

            if not done and t['bars'] >= TIME_STOP:
                # Time stop
                if t['direction'] == 'LONG':
                    exit_r = (cl - t['entry']) / t['risk']
                else:
                    exit_r = (t['entry'] - cl) / t['risk']
                final_r = round(t['pnl_r'] + t['size'] * exit_r, 4)
                reason  = 'TIME'
                done    = True

            if done:
                # Update equity
                pnl_usd = final_r * equity * BRAIN_RISK
                equity  += pnl_usd

                closed.append({
                    'entry_ts':    t['entry_ts'],
                    'exit_ts':     ts,
                    'direction':   t['direction'],
                    'level_type':  t['level_type'],
                    'level_price': t['level_price'],
                    'entry':       t['entry'],
                    'sl_orig':     t['sl_orig'],
                    'g1': t['g1'], 'g2': t['g2'], 'g3': t['g3'],
                    'exit_price':  cl if reason == 'TIME' else (
                                   t['sl_current'] if reason == 'SL' else (
                                   t['g3'] if reason == 'G3' else cl)),
                    'exit_reason': reason,
                    'bars_held':   t['bars'],
                    'g1_hit':      t['g1_hit'],
                    'g2_hit':      t['g2_hit'],
                    'g3_hit':      reason == 'G3',
                    'r_multiple':  final_r,
                    'pnl_usd':     round(pnl_usd, 2),
                    'equity_after': round(equity, 2),
                    'ref_range':   t['ref_range'],
                })
                equity_curve.append(round(equity, 2))
                open_trade = None

        prev_ts = ts

    return closed, signals_log, denied_log, equity_curve


# ── Analytics ─────────────────────────────────────────────────────────────────

def print_results(closed, signals_log, denied_log, equity_curve):
    if not closed:
        print("No closed trades.")
        return

    df = pd.DataFrame(closed)
    n  = len(df)

    first_ts = df['entry_ts'].iloc[0]
    last_ts  = df['exit_ts'].iloc[-1]
    years    = (last_ts - first_ts).total_seconds() / (365.25 * 86400)
    per_yr   = n / years if years > 0 else 0

    wr     = (df['r_multiple'] > 0).sum() / n * 100
    avg_r  = df['r_multiple'].mean()
    tot_r  = df['r_multiple'].sum()

    eq_arr = np.array(equity_curve)
    peak   = np.maximum.accumulate(eq_arr)
    dd     = (eq_arr - peak) / peak * 100
    max_dd = float(dd.min())
    cagr   = ((equity_curve[-1] / INITIAL_EQ) ** (1 / years) - 1) * 100 if years > 0 else 0
    calmar = abs(cagr / max_dd) if max_dd != 0 else 0

    # G1/G2/G3 rates
    g1_rate = df['g1_hit'].sum() / n * 100
    g2_rate = df['g2_hit'].sum() / n * 100
    g3_rate = df['g3_hit'].sum() / n * 100

    # Exit breakdown
    exits = df['exit_reason'].value_counts().to_dict()

    print(f"\n{'='*62}")
    print("  AlphaBrain v4 -- FULL BACKTEST (2017-2026)")
    print(f"{'='*62}")
    print(f"  Trades total      : {n}")
    print(f"  Trades per year   : {per_yr:.1f}  (target 8-15)")
    print(f"  Win rate          : {wr:.1f}%")
    print(f"  Avg R             : {avg_r:+.3f}")
    print(f"  Total R           : {tot_r:+.1f}R")
    print(f"  Final equity      : ${equity_curve[-1]:,.0f}")
    print(f"  CAGR              : {cagr:+.1f}%")
    print(f"  Max DD            : {max_dd:.1f}%")
    print(f"  Calmar            : {calmar:.3f}")
    print(f"  Exits             : {exits}")
    print()
    print(f"  G1 hit rate (SL -> BE)    : {g1_rate:.1f}%  ({df['g1_hit'].sum()} trades)")
    print(f"  G2 hit rate (50% exit)    : {g2_rate:.1f}%  ({df['g2_hit'].sum()} trades)")
    print(f"  G3 hit rate (full exit)   : {g3_rate:.1f}%  ({df['g3_hit'].sum()} trades)")

    # Single-exit CAGR comparison (exit 100% at G1)
    eq_single = INITIAL_EQ
    for _, t in df.iterrows():
        if t['direction'] == 'LONG':
            rpu = abs(t['entry'] - t['sl_orig'])
            if t['g1_hit']:
                single_r = (t['g1'] - t['entry']) / rpu if rpu > 0 else 0
            elif t['r_multiple'] < 0:
                single_r = -1.0
            else:
                single_r = (t['exit_price'] - t['entry']) / rpu if rpu > 0 else 0
        else:
            rpu = abs(t['entry'] - t['sl_orig'])
            if t['g1_hit']:
                single_r = (t['entry'] - t['g1']) / rpu if rpu > 0 else 0
            elif t['r_multiple'] < 0:
                single_r = -1.0
            else:
                single_r = (t['entry'] - t['exit_price']) / rpu if rpu > 0 else 0
        eq_single += single_r * eq_single * BRAIN_RISK

    cagr_single = ((eq_single / INITIAL_EQ) ** (1 / years) - 1) * 100 if years > 0 else 0
    print(f"\n  CAGR (3-tier exit)  : {cagr:+.1f}%")
    print(f"  CAGR (single @ G1)  : {cagr_single:+.1f}%")

    # Per-year breakdown
    print(f"\n  {'Year':<6} {'N':>4} {'WR%':>6} {'AvgR':>7} {'CAGR%':>7}")
    print(f"  {'-'*35}")
    df['year'] = df['entry_ts'].apply(lambda x: x.year)
    yr_eq = INITIAL_EQ
    for yr, grp in df.groupby('year'):
        yn  = len(grp)
        ywr = (grp['r_multiple'] > 0).sum() / yn * 100
        yar = grp['r_multiple'].mean()
        yr_pnl = grp['r_multiple'].sum() * yr_eq * BRAIN_RISK
        yr_cagr = yr_pnl / yr_eq * 100
        yr_eq  += yr_pnl
        print(f"  {yr:<6} {yn:>4} {ywr:>6.1f}% {yar:>+7.3f} {yr_cagr:>+7.1f}%")

    # Level type breakdown
    print(f"\n  {'Level':<22} {'N':>4} {'WR%':>6} {'AvgR':>7} {'G1%':>5} {'G2%':>5}")
    print(f"  {'-'*52}")
    for lname, grp in sorted(df.groupby('level_type'),
                              key=lambda x: -x[1]['r_multiple'].mean()):
        ln   = len(grp)
        lwr  = (grp['r_multiple'] > 0).sum() / ln * 100
        lar  = grp['r_multiple'].mean()
        lg1  = grp['g1_hit'].sum() / ln * 100
        lg2  = grp['g2_hit'].sum() / ln * 100
        print(f"  {lname:<22} {ln:>4} {lwr:>6.1f}% {lar:>+7.3f} {lg1:>5.0f}% {lg2:>5.0f}%")

    # Denial analysis
    print(f"\n  {'='*62}")
    print("  LEVEL DENIAL ANALYSIS")
    print(f"  {'='*62}")
    total_approaches = sum(l['times_tested'] for l in [])   # placeholder
    n_denied = len(denied_log)
    # Approaches = total CONFIRMING transitions = signals_log + denied + remained
    # Approximation: count from signals_log and denied_log
    total_conf = len(signals_log) + n_denied
    denial_rate = n_denied / total_conf * 100 if total_conf else 0
    print(f"  Total level approaches (CONFIRMING): {total_conf}")
    print(f"  Denied (broke through)             : {n_denied}  ({denial_rate:.1f}%)")
    print(f"  Confirmed (signal fired)            : {len(signals_log)}")

    if denied_log:
        print(f"\n  Denied level type breakdown:")
        from collections import Counter
        cnt = Counter(d['type'] for d in denied_log)
        for ltype, c in sorted(cnt.items(), key=lambda x: -x[1]):
            print(f"    {ltype:<22} {c:>4} denials")

    # Denied level retest analysis
    print(f"\n  DENIED LEVEL RETEST ANALYSIS")
    print(f"  (Did denied levels later generate valid signals?)")
    retested = 0
    became_signal = 0
    df_signals = pd.DataFrame(signals_log) if signals_log else pd.DataFrame()
    for d in denied_log:
        if df_signals.empty:
            break
        # Find signals fired AFTER this denial near the same price
        future_sigs = df_signals[df_signals['ts'] > d['ts']]
        if future_sigs.empty:
            continue
        near = future_sigs[
            (future_sigs['entry'] - d['price']).abs() / d['price'] <= 0.015
        ]
        if len(near):
            retested += 1
            became_signal += 1

    if n_denied:
        print(f"  Denied levels later retested as signal: {became_signal}/{n_denied} "
              f"({became_signal/n_denied*100:.0f}%)")
        print(f"  (Validates 'denied level flips to opposite role' concept)")
    else:
        print("  No denied levels to analyse.")


if __name__ == '__main__':
    print("Loading 1H BTC data...")
    df = load_1h()
    print(f"  {df.index[0].date()} -> {df.index[-1].date()}  ({len(df):,} rows)")
    print(f"  Columns: {list(df.columns)}")

    closed, signals_log, denied_log, eq_curve = run_backtest(df)

    print_results(closed, signals_log, denied_log, eq_curve)

    if closed:
        out = os.path.join(os.path.dirname(__file__), '..', 'trades_brain_v4.csv')
        pd.DataFrame(closed).to_csv(out, index=False)
        print(f"\nTrades saved -> trades_brain_v4.csv ({len(closed)} rows)")
