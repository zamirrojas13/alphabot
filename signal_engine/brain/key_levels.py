"""
AlphaBrain v1 — Key Level Calculator
Maps institutional reference prices and liquidity pools.
"""

import pandas as pd
import numpy as np
from datetime import timezone


# ── Helpers ──────────────────────────────────────────────────────────────────

def _ts(df):
    """Ensure index is UTC-aware datetime. Handles 'datetime' column or existing DatetimeIndex."""
    df = df.copy()
    if 'datetime' in df.columns:
        df.index = pd.to_datetime(df['datetime'], utc=True)
        df = df.drop(columns=['datetime'])
    elif not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index, utc=True)
    elif df.index.tz is None:
        df.index = df.index.tz_localize('UTC')
    return df


def _quarter_start_month(dt):
    """Return first month of the quarter containing dt."""
    return {1: 1, 2: 4, 3: 7, 4: 10}[(dt.month - 1) // 3 + 1]


# ── Main calculator ───────────────────────────────────────────────────────────

def calculate_key_levels(df_1h, df_4h, df_daily, df_weekly, df_monthly,
                          as_of=None):
    """
    Calculate all significant price levels as of `as_of` timestamp.
    If as_of is None, uses the last available candle in df_1h.

    Returns dict:  level_name -> {
        'price', 'distance_pct', 'is_above', 'level_type'
    }
    """
    df_1h     = _ts(df_1h)
    df_4h     = _ts(df_4h)
    df_daily  = _ts(df_daily)
    df_weekly = _ts(df_weekly)
    df_monthly = _ts(df_monthly)

    if as_of is None:
        as_of = df_1h.index[-1]
    elif not hasattr(as_of, 'tzinfo') or as_of.tzinfo is None:
        as_of = pd.Timestamp(as_of, tz='UTC')
    else:
        as_of = pd.Timestamp(as_of).tz_convert('UTC')

    # Slice all frames to data available at as_of
    d1h  = df_1h[df_1h.index <= as_of]
    d4h  = df_4h[df_4h.index <= as_of]
    ddly = df_daily[df_daily.index <= as_of]
    dwk  = df_weekly[df_weekly.index <= as_of]
    dmth = df_monthly[df_monthly.index <= as_of]

    current_price = float(d1h['close'].iloc[-1])
    levels = {}

    # ── OPENING PRICES ────────────────────────────────────────────────────────

    # Yearly open: first daily close of current year
    yr = as_of.year
    yr_data = ddly[ddly.index.year == yr]
    if len(yr_data):
        levels['yearly_open'] = {
            'price': float(yr_data['close'].iloc[0]),
            'level_type': 'opening'
        }

    # Quarterly open: first daily close of current quarter
    q_month = _quarter_start_month(as_of)
    q_start = pd.Timestamp(yr, q_month, 1, tz='UTC')
    qtr_data = ddly[ddly.index >= q_start]
    if len(qtr_data):
        levels['quarterly_open'] = {
            'price': float(qtr_data['close'].iloc[0]),
            'level_type': 'opening'
        }

    # Monthly open: first daily close of current month
    mth_start = pd.Timestamp(yr, as_of.month, 1, tz='UTC')
    mth_data = ddly[ddly.index >= mth_start]
    if len(mth_data):
        levels['monthly_open'] = {
            'price': float(mth_data['close'].iloc[0]),
            'level_type': 'opening'
        }

    # Weekly open: first 1H candle of the current week (Sun 17:00 UTC)
    # pandas week starts Monday; BTC week starts Sunday
    # Find last Sunday 17:00 UTC <= as_of
    dow = as_of.weekday()  # Mon=0 … Sun=6
    days_since_sun = (dow + 1) % 7
    last_sun = (as_of - pd.Timedelta(days=days_since_sun)).normalize()
    week_open_ts = last_sun + pd.Timedelta(hours=17)
    wk_1h = d1h[d1h.index >= week_open_ts]
    if len(wk_1h):
        levels['weekly_open'] = {
            'price': float(wk_1h['open'].iloc[0]),
            'level_type': 'opening'
        }

    # ── PRIOR PERIOD EXTREMES ─────────────────────────────────────────────────

    # Prior week (Mon–Sun in parquet weekly candles; we use raw 1H data)
    prev_week_end = week_open_ts
    prev_week_start = week_open_ts - pd.Timedelta(days=7)
    pw = d1h[(d1h.index >= prev_week_start) & (d1h.index < prev_week_end)]
    if len(pw):
        levels['prev_week_high'] = {
            'price': float(pw['high'].max()),
            'level_type': 'prior_high'
        }
        levels['prev_week_low'] = {
            'price': float(pw['low'].min()),
            'level_type': 'prior_low'
        }

    # Prior month
    prev_mth_end = mth_start
    prev_mth_start = (mth_start - pd.Timedelta(days=1)).replace(day=1)
    pm = ddly[(ddly.index >= prev_mth_start) & (ddly.index < prev_mth_end)]
    if len(pm):
        levels['prev_month_high'] = {
            'price': float(pm['high'].max()),
            'level_type': 'prior_high'
        }
        levels['prev_month_low'] = {
            'price': float(pm['low'].min()),
            'level_type': 'prior_low'
        }

    # Prior quarter
    prev_q_end = q_start
    pq_month = _quarter_start_month(q_start - pd.Timedelta(days=1))
    pq_yr = (q_start - pd.Timedelta(days=1)).year
    prev_q_start = pd.Timestamp(pq_yr, pq_month, 1, tz='UTC')
    pq = ddly[(ddly.index >= prev_q_start) & (ddly.index < prev_q_end)]
    if len(pq):
        levels['prev_quarter_high'] = {
            'price': float(pq['high'].max()),
            'level_type': 'prior_high'
        }
        levels['prev_quarter_low'] = {
            'price': float(pq['low'].min()),
            'level_type': 'prior_low'
        }

    # Prior year
    prev_yr = ddly[ddly.index.year == yr - 1]
    if len(prev_yr):
        levels['prev_year_high'] = {
            'price': float(prev_yr['high'].max()),
            'level_type': 'prior_high'
        }
        levels['prev_year_low'] = {
            'price': float(prev_yr['low'].min()),
            'level_type': 'prior_low'
        }

    # ── CURRENT WEEK RANGE ────────────────────────────────────────────────────

    cur_wk = d1h[d1h.index >= week_open_ts]
    if len(cur_wk):
        wk_high = float(cur_wk['high'].max())
        wk_low  = float(cur_wk['low'].min())
        levels['week_high_so_far'] = {
            'price': wk_high,
            'level_type': 'dynamic'
        }
        levels['week_low_so_far'] = {
            'price': wk_low,
            'level_type': 'dynamic'
        }
        levels['week_midpoint'] = {
            'price': round((wk_high + wk_low) / 2, 2),
            'level_type': 'dynamic'
        }

    # ── ALL TIME REFERENCE ────────────────────────────────────────────────────

    levels['all_time_high'] = {
        'price': float(ddly['high'].max()),
        'level_type': 'extreme'
    }

    # Cycle low: lowest close in last 4 years
    four_yr_ago = as_of - pd.Timedelta(days=4 * 365)
    cyc = ddly[ddly.index >= four_yr_ago]
    if len(cyc):
        levels['cycle_low'] = {
            'price': float(cyc['low'].min()),
            'level_type': 'extreme'
        }

    # ── ANNOTATE distance / direction ─────────────────────────────────────────

    for name, info in levels.items():
        p = info['price']
        dist = (current_price - p) / p * 100   # positive = price above level
        info['distance_pct'] = round(dist, 3)
        info['is_above'] = current_price >= p

    return levels, current_price


# ── Filter to nearby levels ───────────────────────────────────────────────────

def calculate_level_strength(level_price, df_4h, lookback_bars=200):
    """
    Count how many times in the last `lookback_bars` 4H bars price touched
    within 0.3% of `level_price` AND then reversed direction.

    A reversal is confirmed when the touching candle's close is at least
    0.2% on the far side of the level (wick-to-level, body-away pattern).

    Returns:
        {
          'touches': int,
          'strength': 'LOW' | 'MEDIUM' | 'HIGH',
          'weight': 1.0 | 1.3 | 1.5,
        }
    """
    TOUCH_BAND  = 0.003   # 0.3% — strict: high or low within ±0.3% of level
    CLOSE_CLEAR = 0.003   # 0.3% — close must be this far from level to confirm reversal

    df = _ts(df_4h).tail(lookback_bars)

    touches = 0
    for _, row in df.iterrows():
        hi = float(row['high'])
        lo = float(row['low'])
        cl = float(row['close'])

        lo_dist = abs(lo - level_price) / level_price
        hi_dist = abs(hi - level_price) / level_price

        # Support touch: low pinged within 0.3% of level, close 0.3%+ above → reversal up
        if lo_dist <= TOUCH_BAND and cl >= level_price * (1 + CLOSE_CLEAR):
            touches += 1
        # Resistance touch: high pinged within 0.3% of level, close 0.3%+ below → reversal down
        elif hi_dist <= TOUCH_BAND and cl <= level_price * (1 - CLOSE_CLEAR):
            touches += 1

    if touches >= 4:
        strength, weight = 'HIGH',   1.5
    elif touches >= 2:
        strength, weight = 'MEDIUM', 1.3
    else:
        strength, weight = 'LOW',    1.0

    return {'touches': touches, 'strength': strength, 'weight': weight}


def get_nearest_levels(all_levels, current_price, max_distance_pct=5.0):
    """
    Returns only levels within max_distance_pct of current_price,
    sorted by absolute distance (nearest first).
    Excludes dynamic intra-week levels (week_high_so_far etc.).
    """
    SKIP = {'week_high_so_far', 'week_low_so_far', 'week_midpoint'}
    result = []
    for name, info in all_levels.items():
        if name in SKIP:
            continue
        if abs(info['distance_pct']) <= max_distance_pct:
            result.append({
                'name': name,
                **info
            })
    result.sort(key=lambda x: abs(x['distance_pct']))
    return result
