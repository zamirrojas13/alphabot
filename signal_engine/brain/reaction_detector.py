"""
AlphaBrain v1 — Level Reaction Detector
Core signal logic: price touches level + rejection candle → entry signal.
"""

import pandas as pd
from .key_levels import calculate_key_levels, get_nearest_levels
from .fibonacci import calculate_targets
from .brain_config import (
    LEVEL_TOUCH_THRESHOLD, REJECTION_CLOSE_PCT,
    MIN_WICK_RATIO, SL_BEYOND_LEVEL,
    LEVEL_MAX_DISTANCE, GOAL_1_MULTIPLIER,
    GOAL_2_MULTIPLIER, GOAL_3_MULTIPLIER,
)

# Level types that generate signals.
# Opening prices (weekly_open, monthly_open, quarterly_open, yearly_open)
# removed in v2 — they are context only (see macro_context.py), not entry triggers.
SIGNAL_LEVELS = {
    'prev_week_high', 'prev_week_low',
    'prev_month_high',
    'prev_quarter_high', 'prev_quarter_low',
    'prev_year_high', 'prev_year_low',
    'all_time_high', 'cycle_low',
}
# prev_month_low removed in v3: 0% WR across 8 trades (-5.69R), consistently bad


def _is_rejection_candle(row, direction):
    """
    Check if a single 4H OHLC candle shows rejection from a level.

    direction: 'LONG' (touched support) or 'SHORT' (touched resistance)
    """
    o, h, l, c = float(row['open']), float(row['high']), float(row['low']), float(row['close'])
    candle_range = h - l
    if candle_range <= 0:
        return False

    body = abs(c - o)
    body = max(body, 1e-8)  # avoid div/0 on doji

    if direction == 'LONG':
        # Close must be in upper 40% of range
        close_position = (c - l) / candle_range
        if close_position < REJECTION_CLOSE_PCT:
            return False
        # Bullish body OR large lower wick
        lower_wick = o - l if c > o else c - l
        lower_wick = max(lower_wick, 0)
        bullish_body = c > o
        big_wick = lower_wick / body >= MIN_WICK_RATIO
        return bullish_body or big_wick

    else:  # SHORT
        # Close must be in lower 40% of range
        close_position = (h - c) / candle_range
        if close_position < REJECTION_CLOSE_PCT:
            return False
        # Bearish body OR large upper wick
        upper_wick = h - o if c < o else h - c
        upper_wick = max(upper_wick, 0)
        bearish_body = c < o
        big_wick = upper_wick / body >= MIN_WICK_RATIO
        return bearish_body or big_wick


def detect_level_reaction(df_4h, key_levels, current_price,
                           prev_week_high=None, prev_week_low=None,
                           lookback_candles=3):
    """
    Scan the most recent `lookback_candles` 4H candles for a valid
    level reaction signal.

    Returns a signal dict or None.

    key_levels : output of calculate_key_levels()
    prev_week_high / prev_week_low : for reference_range in targets.
        If not supplied, falls back to prev_week_high/low from key_levels.
    lookback_candles : how many recent 4H candles to check (default 3 = 12h)
    """
    if 'datetime' in df_4h.columns:
        df4 = df_4h.copy()
        df4.index = pd.to_datetime(df4['datetime'], utc=True)
        df4 = df4.drop(columns=['datetime'])
    else:
        df4 = df_4h

    recent = df4.tail(lookback_candles)

    # Reference range for fibonacci targets
    if prev_week_high is None:
        prev_week_high = key_levels.get('prev_week_high', {}).get('price')
    if prev_week_low is None:
        prev_week_low  = key_levels.get('prev_week_low', {}).get('price')

    if prev_week_high and prev_week_low:
        ref_range = prev_week_high - prev_week_low
    else:
        ref_range = current_price * 0.05   # fallback: 5% of price

    # Filter to signal-eligible nearby levels
    nearby = get_nearest_levels(key_levels, current_price,
                                 max_distance_pct=LEVEL_MAX_DISTANCE)
    nearby = [n for n in nearby if n['name'] in SIGNAL_LEVELS]

    signals = []

    for level_info in nearby:
        level_name  = level_info['name']
        level_price = level_info['price']
        touch_band  = level_price * LEVEL_TOUCH_THRESHOLD

        for ts, row in recent.iterrows():
            # -- CHECK 1: did candle touch the level? --
            # LONG setup: low came within touch_band below the level
            long_touch  = row['low']  <= level_price * (1 + LEVEL_TOUCH_THRESHOLD) \
                          and row['low'] >= level_price * (1 - LEVEL_TOUCH_THRESHOLD * 3)
            # SHORT setup: high came within touch_band above the level
            short_touch = row['high'] >= level_price * (1 - LEVEL_TOUCH_THRESHOLD) \
                          and row['high'] <= level_price * (1 + LEVEL_TOUCH_THRESHOLD * 3)

            # Determine which direction based on level type + price position
            # Support levels → look for LONG; Resistance → SHORT
            is_support    = level_info['level_type'] == 'prior_low' \
                            or (level_info['level_type'] == 'opening'
                                and not level_info['is_above'])
            is_resistance = level_info['level_type'] == 'prior_high' \
                            or (level_info['level_type'] == 'opening'
                                and level_info['is_above'])

            # Opening prices: direction is determined by which side price is on
            if level_info['level_type'] == 'opening':
                is_support    = not level_info['is_above']   # price below open → support
                is_resistance = level_info['is_above']        # price above open → resistance

            # Extremes: ATH is always resistance, cycle_low always support
            if level_name == 'all_time_high':
                is_support, is_resistance = False, True
            if level_name == 'cycle_low':
                is_support, is_resistance = True, False

            for direction, touched in [('LONG', long_touch), ('SHORT', short_touch)]:
                if not touched:
                    continue
                if direction == 'LONG' and not is_support:
                    continue
                if direction == 'SHORT' and not is_resistance:
                    continue

                # -- CHECK 2: rejection candle? --
                if not _is_rejection_candle(row, direction):
                    continue

                # -- All checks passed → build signal --
                entry = float(row['close'])

                if direction == 'LONG':
                    sl = level_price * (1 - SL_BEYOND_LEVEL)
                else:
                    sl = level_price * (1 + SL_BEYOND_LEVEL)

                # Use raw range for goal calculation
                targets = calculate_targets(level_price, direction, ref_range)

                risk_per_unit = abs(entry - sl)
                rr1 = (abs(targets['goal_1'] - entry) / risk_per_unit) if risk_per_unit else 0

                signals.append({
                    'signal':               direction,
                    'level_type':           level_name,
                    'level_price':          round(level_price, 2),
                    'reaction_candle_time': ts,
                    'entry_price':          round(entry, 2),
                    'sl':                   round(sl, 2),
                    'goal_1':               targets['goal_1'],
                    'goal_2':               targets['goal_2'],
                    'goal_3':               targets['goal_3'],
                    'rr_goal1':             round(rr1, 2),
                    'ref_range':            round(ref_range, 2),
                })

    # Return most recent signal if multiple (rare)
    if signals:
        signals.sort(key=lambda x: x['reaction_candle_time'], reverse=True)
        return signals[0]
    return None


def scan_historical_signals(df_1h, df_4h, df_daily, df_weekly, df_monthly,
                              start_date, end_date):
    """
    Walk through history week-by-week, recalculate levels, and detect
    signals on each 4H candle. Used for backtesting.

    Returns list of signal dicts with timestamps.
    """
    if 'datetime' in df_1h.columns:
        df1 = df_1h.copy(); df1.index = pd.to_datetime(df1['datetime'], utc=True); df1.drop(columns=['datetime'], inplace=True)
    else:
        df1 = df_1h

    if 'datetime' in df_4h.columns:
        df4 = df_4h.copy(); df4.index = pd.to_datetime(df4['datetime'], utc=True); df4.drop(columns=['datetime'], inplace=True)
    else:
        df4 = df_4h

    if 'datetime' in df_daily.columns:
        dfd = df_daily.copy(); dfd.index = pd.to_datetime(dfd['datetime'], utc=True); dfd.drop(columns=['datetime'], inplace=True)
    else:
        dfd = df_daily

    if 'datetime' in df_weekly.columns:
        dfw = df_weekly.copy(); dfw.index = pd.to_datetime(dfw['datetime'], utc=True); dfw.drop(columns=['datetime'], inplace=True)
    else:
        dfw = df_weekly

    if 'datetime' in df_monthly.columns:
        dfm = df_monthly.copy(); dfm.index = pd.to_datetime(dfm['datetime'], utc=True); dfm.drop(columns=['datetime'], inplace=True)
    else:
        dfm = df_monthly

    start = pd.Timestamp(start_date, tz='UTC')
    end   = pd.Timestamp(end_date,   tz='UTC')

    # Iterate candle-by-candle on 4H
    candles_4h = df4[(df4.index >= start) & (df4.index < end)]

    all_signals = []
    last_signal_ts = None

    for ts, row in candles_4h.iterrows():
        # Recalculate levels using all data up to this candle
        d1  = df1[df1.index <= ts]
        d4  = df4[df4.index <= ts]
        dd  = dfd[dfd.index <= ts]
        dw  = dfw[dfw.index <= ts]
        dm  = dfm[dfm.index <= ts]

        if len(d1) < 2 or len(dd) < 10:
            continue

        current_price = float(d1['close'].iloc[-1])

        # Rebuild key_levels without modifying original dfs
        from signal_engine.brain.key_levels import calculate_key_levels as _ckl
        try:
            # Pass already-indexed dfs — _ts() will handle them
            levels, _ = _ckl(d1, d4, dd, dw, dm, as_of=ts)
        except Exception:
            continue

        # Check only the candle at ts (single candle, not lookback)
        candle_df = df4.loc[[ts]]

        # Build prev week range
        pw_high = levels.get('prev_week_high', {}).get('price')
        pw_low  = levels.get('prev_week_low',  {}).get('price')

        sig = detect_level_reaction(
            candle_df, levels, current_price,
            prev_week_high=pw_high,
            prev_week_low=pw_low,
            lookback_candles=1,
        )

        if sig is None:
            continue

        # Cooldown: skip if signal within 5 4H candles of last (20h)
        if last_signal_ts and (ts - last_signal_ts).total_seconds() < 5 * 4 * 3600:
            continue

        sig['candle_time'] = ts
        all_signals.append(sig)
        last_signal_ts = ts

    return all_signals
