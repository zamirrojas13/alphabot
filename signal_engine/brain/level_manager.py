"""
AlphaBrain v4 — Level Lifecycle Manager
The memory of the system. Levels persist until confirmed or denied.
Read/writes brain_levels.json for crash recovery.
"""
import json
import uuid
from pathlib import Path
from datetime import date

import pandas as pd

from .key_levels import calculate_level_strength

# ── Constants ──────────────────────────────────────────────────────────────────

LEVEL_DIRECTIONS = {
    'prev_week_high':    'RESISTANCE',
    'prev_month_high':   'RESISTANCE',
    'prev_quarter_high': 'RESISTANCE',
    'prev_year_high':    'RESISTANCE',
    'all_time_high':     'RESISTANCE',
    'prev_week_low':     'SUPPORT',
    'prev_month_low':    'SUPPORT',
    'prev_quarter_low':  'SUPPORT',
    'prev_year_low':     'SUPPORT',
    'cycle_low':         'SUPPORT',
}

PREFIX = {
    'prev_week_high': 'PWH', 'prev_week_low': 'PWL',
    'prev_month_high': 'PMH', 'prev_month_low': 'PML',
    'prev_quarter_high': 'PQH', 'prev_quarter_low': 'PQL',
    'prev_year_high': 'PYH', 'prev_year_low': 'PYL',
    'all_time_high': 'ATH', 'cycle_low': 'CYL',
}

ARRIVAL_THRESHOLD  = 0.008   # 0.8% — price is "at" the level
DENIAL_THRESHOLD   = 0.015   # 1.5% — close through = level denied
RETREAT_THRESHOLD  = 0.020   # 2.0% — moved away → reset to WATCHING
DEDUP_TOLERANCE    = 0.005   # 0.5% — dedup window

# Timeframe priority: higher number = higher priority = wins dedup contest
TF_PRIORITY = {
    'prev_week_high':    1, 'prev_week_low':    1,
    'prev_month_high':   2, 'prev_month_low':   2,
    'prev_quarter_high': 3, 'prev_quarter_low': 3,
    'prev_year_high':    4, 'prev_year_low':    4,
    'all_time_high':     5, 'cycle_low':        5,
}

STATE_DIR = Path(__file__).parent.parent.parent   # alphabot root


# ── Level factory ─────────────────────────────────────────────────────────────

def _make_level(level_type, price, calculated_date, df_4h=None, notes=''):
    direction = LEVEL_DIRECTIONS[level_type]
    strength_info = calculate_level_strength(price, df_4h) if df_4h is not None \
                    else {'strength': 'LOW', 'weight': 1.0, 'touches': 0}
    date_str = str(calculated_date)[:10].replace('-', '')
    level_id = f"{PREFIX[level_type]}-{date_str}"

    return {
        'id':               level_id,
        'price':            round(float(price), 2),
        'type':             level_type,
        'direction':        direction,
        'calculated_date':  str(calculated_date)[:10],
        'status':           'WATCHING',
        'strength':         strength_info['strength'],
        'weight':           strength_info['weight'],
        'touches':          strength_info['touches'],
        'times_tested':     0,
        'last_tested':      None,
        'confirming_since': None,
        'confirmed_ts':     None,
        'denied_ts':        None,
        'trade_id':         None,
        'notes':            notes,
    }


def _dedup_check(levels, new_type, price, tolerance=DEDUP_TOLERANCE):
    """
    Priority-aware dedup check.
    Returns (can_add: bool, remove_idx: int | None).
      (True,  None) — no conflict, add freely
      (True,  idx)  — new level wins, remove existing at idx then add
      (False, None) — existing level wins, skip new level
    """
    new_pri = TF_PRIORITY.get(new_type, 0)
    for i, lvl in enumerate(levels):
        if lvl['status'] not in ('WATCHING', 'CONFIRMING'):
            continue
        if abs(lvl['price'] - price) / max(price, 1) <= tolerance:
            existing_pri = TF_PRIORITY.get(lvl['type'], 0)
            if new_pri > existing_pri:
                print(f"DEDUP: removed {lvl['type']} level ${lvl['price']:.0f} "
                      f"-- superseded by {new_type}")
                return True, i
            else:
                return False, None
    return True, None


# ── Public API ────────────────────────────────────────────────────────────────

def initialize_levels(df_1h, df_4h, df_daily, df_weekly, df_monthly, as_of=None):
    """
    Build the initial watchlist from all available history.
    Called once on first run or after reset.
    Returns list of level dicts sorted by distance from current price.
    """
    def _prep(df):
        d = df.copy()
        if 'datetime' in d.columns:
            d.index = pd.to_datetime(d['datetime'], utc=True)
            d = d.drop(columns=['datetime'])
        elif d.index.tz is None:
            d.index = d.index.tz_localize('UTC')
        return d

    d1  = _prep(df_1h)
    d4  = _prep(df_4h)
    dd  = _prep(df_daily)

    as_of = as_of or d1.index[-1]
    as_of = pd.Timestamp(as_of, tz='UTC') if not hasattr(as_of, 'tz') else as_of

    d1  = d1[d1.index <= as_of]
    d4  = d4[d4.index <= as_of]
    dd  = dd[dd.index <= as_of]

    current_price = float(d1['close'].iloc[-1])
    levels = []
    today = as_of.date()

    def add(ltype, price, notes=''):
        natural_dir = LEVEL_DIRECTIONS[ltype]
        # Direction validity check: drop levels whose signal would be immediately wrong
        if natural_dir == 'RESISTANCE' and current_price > price:
            # Price already above this "resistance" — stale, skip
            return
        if natural_dir == 'SUPPORT' and current_price < price:
            # Price already below this "support" — stale, skip
            return
        can_add, remove_idx = _dedup_check(levels, ltype, price)
        if remove_idx is not None:
            levels.pop(remove_idx)
        if can_add:
            levels.append(_make_level(ltype, price, today, d4, notes))

    yr = as_of.year

    # Prior week
    dow = as_of.weekday()
    days_since_mon = dow
    last_mon = as_of - pd.Timedelta(days=days_since_mon)
    prev_wk_end = last_mon.normalize()
    prev_wk_start = prev_wk_end - pd.Timedelta(days=7)
    pw = d1[(d1.index >= prev_wk_start) & (d1.index < prev_wk_end)]
    if len(pw):
        add('prev_week_high', float(pw['high'].max()), 'Prior week high')
        add('prev_week_low',  float(pw['low'].min()),  'Prior week low')

    # Prior month
    mth_start = pd.Timestamp(yr, as_of.month, 1, tz='UTC')
    prev_mth_end = mth_start
    prev_mth_start = (mth_start - pd.Timedelta(days=1)).replace(day=1)
    pm = dd[(dd.index >= prev_mth_start) & (dd.index < prev_mth_end)]
    if len(pm):
        add('prev_month_high', float(pm['high'].max()), 'Prior month high')
        add('prev_month_low',  float(pm['low'].min()),  'Prior month low')

    # Prior quarter
    q_month = {1:1, 2:4, 3:7, 4:10}[(as_of.month - 1) // 3 + 1]
    q_start = pd.Timestamp(yr, q_month, 1, tz='UTC')
    pq_end = q_start
    pq_m   = _quarter_start_month(q_start - pd.Timedelta(days=1))
    pq_yr  = (q_start - pd.Timedelta(days=1)).year
    pq_start = pd.Timestamp(pq_yr, pq_m, 1, tz='UTC')
    pq = dd[(dd.index >= pq_start) & (dd.index < pq_end)]
    if len(pq):
        add('prev_quarter_high', float(pq['high'].max()), 'Prior quarter high')
        add('prev_quarter_low',  float(pq['low'].min()),  'Prior quarter low')

    # Prior year
    py = dd[dd.index.year == yr - 1]
    if len(py):
        add('prev_year_high', float(py['high'].max()), f'{yr-1} high')
        add('prev_year_low',  float(py['low'].min()),  f'{yr-1} low')

    # All-time high and cycle low
    add('all_time_high', float(dd['high'].max()), 'All-time high')
    four_yr_ago = as_of - pd.Timedelta(days=4 * 365)
    cyc = dd[dd.index >= four_yr_ago]
    if len(cyc):
        add('cycle_low', float(cyc['low'].min()), '4-year cycle low')

    levels.sort(key=lambda x: abs(x['price'] - current_price))
    return levels


def _quarter_start_month(dt):
    return {1:1, 2:4, 3:7, 4:10}[(dt.month - 1) // 3 + 1]


def update_levels(levels, df_1h, df_4h, as_of):
    """
    Called at each period boundary (weekly, monthly, quarterly, yearly).
    Adds NEW levels from the just-closed period.
    Existing WATCHING/CONFIRMING levels are untouched.
    Returns count of new levels added.
    """
    added = 0
    as_of = pd.Timestamp(as_of, tz='UTC') if not hasattr(as_of, 'tz') else as_of

    if 'datetime' in df_1h.columns:
        d1 = df_1h.copy(); d1.index = pd.to_datetime(d1['datetime'], utc=True); d1.drop(columns=['datetime'], inplace=True)
    else:
        d1 = df_1h

    today = as_of.date()

    def add(ltype, price, notes=''):
        nonlocal added
        can_add, remove_idx = _dedup_check(levels, ltype, price)
        if remove_idx is not None:
            levels.pop(remove_idx)
        if can_add:
            levels.append(_make_level(ltype, price, today, df_4h, notes))
            added += 1

    return added


def check_arrival(levels, current_price, ts):
    """
    Scan all levels and transition WATCHING -> CONFIRMING on arrival.
    Also resets CONFIRMING -> WATCHING if price retreated 2%.
    Returns list of newly-arriving level IDs.
    """
    arrived = []
    for lvl in levels:
        lp = lvl['price']
        dist = abs(current_price - lp) / lp

        if lvl['status'] == 'WATCHING' and dist <= ARRIVAL_THRESHOLD:
            lvl['status'] = 'CONFIRMING'
            lvl['confirming_since'] = str(ts)
            lvl['times_tested'] += 1
            lvl['last_tested'] = str(ts)
            arrived.append(lvl['id'])

        elif lvl['status'] == 'CONFIRMING':
            # Reset if price retreated more than 2% away
            if lvl['direction'] == 'SUPPORT' and current_price > lp * (1 + RETREAT_THRESHOLD):
                lvl['status'] = 'WATCHING'
                lvl['confirming_since'] = None
            elif lvl['direction'] == 'RESISTANCE' and current_price < lp * (1 - RETREAT_THRESHOLD):
                lvl['status'] = 'WATCHING'
                lvl['confirming_since'] = None

    return arrived


def invalidate_level(level, breakthrough_price, ts):
    """Mark level as DENIED when price closes through it."""
    level['status'] = 'DENIED'
    level['denied_ts'] = str(ts)
    level['notes'] += f' | Denied at {breakthrough_price:.0f} on {str(ts)[:10]}'


def get_active_levels(levels, current_price=None):
    """Return WATCHING + CONFIRMING levels, sorted by distance."""
    active = [l for l in levels if l['status'] in ('WATCHING', 'CONFIRMING')]
    if current_price:
        active.sort(key=lambda x: abs(x['price'] - current_price))
    return active


# ── Persistence ────────────────────────────────────────────────────────────────

def load_levels(path=None):
    fp = Path(path) if path else STATE_DIR / 'brain_levels.json'
    if not fp.exists():
        return []
    with open(fp, 'r') as f:
        data = json.load(f)
    return data.get('levels', [])


def save_levels(levels, path=None):
    fp = Path(path) if path else STATE_DIR / 'brain_levels.json'
    with open(fp, 'w') as f:
        json.dump({
            'last_updated': str(pd.Timestamp.utcnow()),
            'levels': levels
        }, f, indent=2)
