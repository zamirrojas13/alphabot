"""
AlphaBrain v4 — 1H Signal Confirmation Scanner
Called every 10 minutes. Checks CONFIRMING levels for 1H rejection pattern.
"""
import pandas as pd
import numpy as np

from .fibonacci import calculate_targets
from .brain_config import SL_BEYOND_LEVEL

TOUCH_BAND       = 0.005   # 0.5% — low/high must be within this of level
CLOSE_POSITION   = 0.65    # close must be in top/bottom 35% (= 65% from far side)
WICK_RATIO       = 2.0     # wick >= 2x body
VOL_MULTIPLIER   = 1.2     # volume must exceed 1.2x 20-bar avg


def _prep_1h(df_1h):
    d = df_1h.copy()
    if 'datetime' in d.columns:
        d.index = pd.to_datetime(d['datetime'], utc=True)
        d = d.drop(columns=['datetime'])
    elif d.index.tz is None:
        d.index = d.index.tz_localize('UTC')
    d['vol_ma20'] = d['volume'].rolling(20).mean()
    d['ema9']  = d['close'].ewm(span=9,  adjust=False).mean()
    d['ema21'] = d['close'].ewm(span=21, adjust=False).mean()
    return d


def _is_confirmed_1h(row, direction, ema9, ema21, color_streak):
    """
    Check if a single 1H row is a valid rejection candle at a level.
    direction : 'SUPPORT' or 'RESISTANCE'
    color_streak : number of same-color candles before this one (positive=green, negative=red)
    """
    hi, lo, op, cl = float(row['high']), float(row['low']), float(row['open']), float(row['close'])
    rng = hi - lo
    if rng <= 0:
        return False

    body = max(abs(cl - op), 1e-8)
    vol_ok = (not pd.isna(row.get('vol_ma20', float('nan'))) and
              row['volume'] > VOL_MULTIPLIER * row['vol_ma20'])

    if not vol_ok:
        return False

    if direction == 'SUPPORT':
        top35   = (cl - lo) / rng >= CLOSE_POSITION
        green   = cl > op
        lo_wick = max(min(op, cl) - lo, 0)
        big_wick = lo_wick / body >= WICK_RATIO
        candle_ok = top35 and (green or big_wick)
        # EMA filter: EMA9 > EMA21 OR first green after 3+ reds
        ema_ok = (ema9 is not None and ema21 is not None and ema9 > ema21)
        trend_flip = (color_streak <= -3 and green)  # first green after 3+ reds
        return candle_ok and (ema_ok or trend_flip)

    else:  # RESISTANCE
        bot35   = (hi - cl) / rng >= CLOSE_POSITION
        red     = cl < op
        hi_wick = max(hi - max(op, cl), 0)
        big_wick = hi_wick / body >= WICK_RATIO
        candle_ok = bot35 and (red or big_wick)
        ema_ok = (ema9 is not None and ema21 is not None and ema9 < ema21)
        trend_flip = (color_streak >= 3 and red)   # first red after 3+ greens
        return candle_ok and (ema_ok or trend_flip)


def scan_brain(df_1h, active_levels, prev_week_range, lookback_candles=3,
               as_of=None):
    """
    Check all CONFIRMING levels for 1H confirmation signal.
    Looks at the last `lookback_candles` completed 1H bars.

    Returns list of signal dicts (usually 0 or 1).
    """
    d1 = _prep_1h(df_1h)
    if as_of:
        as_of_ts = pd.Timestamp(as_of)
        if as_of_ts.tz is None:
            as_of_ts = as_of_ts.tz_localize('UTC')
        d1 = d1[d1.index <= as_of_ts]

    if len(d1) < 21:
        return []

    recent = d1.tail(lookback_candles + 4)  # extra for streak calc

    # Compute color streak up to each candle
    colors = [1 if row['close'] > row['open'] else -1 for _, row in recent.iterrows()]

    def streak_before(idx):
        """Consecutive same-color count before position idx."""
        if idx == 0:
            return 0
        color = colors[idx - 1]
        count = 0
        for i in range(idx - 1, -1, -1):
            if colors[i] == color:
                count += 1
            else:
                break
        return count * color   # positive=green streak, negative=red streak

    signals = []
    confirming = [l for l in active_levels if l['status'] == 'CONFIRMING']

    for lvl in confirming:
        lp        = lvl['price']
        direction = lvl['direction']

        for i, (ts, row) in enumerate(recent.tail(lookback_candles).iterrows()):
            hi, lo = float(row['high']), float(row['low'])

            # Touch check
            if direction == 'SUPPORT':
                touched = abs(lo - lp) / lp <= TOUCH_BAND
            else:
                touched = abs(hi - lp) / lp <= TOUCH_BAND
            if not touched:
                continue

            ema9  = row.get('ema9')
            ema21 = row.get('ema21')
            streak = streak_before(-(lookback_candles - i))

            if not _is_confirmed_1h(row, direction, ema9, ema21, streak):
                continue

            entry = float(row['close'])
            sl    = lp * (1 - SL_BEYOND_LEVEL) if direction == 'SUPPORT' \
                    else lp * (1 + SL_BEYOND_LEVEL)
            ref   = prev_week_range if prev_week_range else entry * 0.05
            tgts  = calculate_targets(lp, 'LONG' if direction == 'SUPPORT' else 'SHORT', ref)

            signals.append({
                'strategy':       f"BRAIN_{lvl['type']}_{direction}",
                'level_price':    round(lp, 2),
                'level_type':     lvl['type'],
                'level_id':       lvl['id'],
                'level_strength': lvl['strength'],
                'direction':      'LONG' if direction == 'SUPPORT' else 'SHORT',
                'entry':          round(entry, 2),
                'sl':             round(sl, 2),
                'goal_1':         tgts['goal_1'],
                'goal_2':         tgts['goal_2'],
                'goal_3':         tgts['goal_3'],
                'ref_range':      round(ref, 2),
                'timeframe':      '1H',
                'candle_ts':      ts,
            })
            break   # one signal per level

    return signals
