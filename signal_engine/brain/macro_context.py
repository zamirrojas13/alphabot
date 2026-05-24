"""
AlphaBrain v1 — Macro Context
Display-only in v1: bias labels for yearly/quarterly/monthly trend.
Will become a filter only after backtest confirms core signal edge.
"""

import pandas as pd


def _ts(df):
    if 'datetime' in df.columns:
        df = df.copy()
        df.index = pd.to_datetime(df['datetime'], utc=True)
        df = df.drop(columns=['datetime'])
    elif df.index.tz is None:
        df = df.copy()
        df.index = df.index.tz_localize('UTC')
    return df


def _bias(current_price, open_price, threshold_pct):
    if open_price <= 0:
        return 'NEUTRAL'
    ratio = (current_price - open_price) / open_price
    if ratio > threshold_pct:
        return 'BULL'
    elif ratio < -threshold_pct:
        return 'BEAR'
    return 'NEUTRAL'


def _sma(series, period):
    """Rolling SMA on the last `period` rows."""
    if len(series) < period:
        return None
    return float(series.tail(period).mean())


def get_macro_context(df_daily, df_weekly, df_monthly, as_of=None):
    """
    Returns macro context dict — display only in v1.

    {
      'yearly_bias':     'BULL'/'BEAR'/'NEUTRAL',
      'quarterly_bias':  'BULL'/'BEAR'/'NEUTRAL',
      'monthly_bias':    'BULL'/'BEAR'/'NEUTRAL',
      'above_200d_sma':  bool,
      'above_200w_sma':  bool,
      'yearly_open':     float,
      'quarterly_open':  float,
      'monthly_open':    float,
      'current_price':   float,
    }
    """
    dfd = _ts(df_daily)
    dfw = _ts(df_weekly)

    if as_of is None:
        as_of = dfd.index[-1]
    else:
        as_of = pd.Timestamp(as_of, tz='UTC') if not hasattr(as_of, 'tzinfo') or as_of.tzinfo is None \
                else pd.Timestamp(as_of).tz_convert('UTC')

    dfd = dfd[dfd.index <= as_of]
    dfw = dfw[dfw.index <= as_of]

    current_price = float(dfd['close'].iloc[-1])
    yr = as_of.year

    # ── Opening prices ────────────────────────────────────────────────────────
    def _quarter_start_month(dt):
        return {1: 1, 2: 4, 3: 7, 4: 10}[(dt.month - 1) // 3 + 1]

    yr_data = dfd[dfd.index.year == yr]
    yearly_open = float(yr_data['close'].iloc[0]) if len(yr_data) else current_price

    q_month = _quarter_start_month(as_of)
    q_start = pd.Timestamp(yr, q_month, 1, tz='UTC')
    q_data  = dfd[dfd.index >= q_start]
    quarterly_open = float(q_data['close'].iloc[0]) if len(q_data) else current_price

    mth_start  = pd.Timestamp(yr, as_of.month, 1, tz='UTC')
    mth_data   = dfd[dfd.index >= mth_start]
    monthly_open = float(mth_data['close'].iloc[0]) if len(mth_data) else current_price

    # ── Bias labels ──────────────────────────────────────────────────────────
    yearly_bias    = _bias(current_price, yearly_open,    0.03)
    quarterly_bias = _bias(current_price, quarterly_open, 0.03)
    monthly_bias   = _bias(current_price, monthly_open,   0.02)

    # ── 200-day SMA ──────────────────────────────────────────────────────────
    sma_200d = _sma(dfd['close'], 200)
    above_200d = current_price > sma_200d if sma_200d else False

    # ── 200-week SMA ─────────────────────────────────────────────────────────
    sma_200w = _sma(dfw['close'], 200)
    above_200w = current_price > sma_200w if sma_200w else False

    return {
        'yearly_bias':     yearly_bias,
        'quarterly_bias':  quarterly_bias,
        'monthly_bias':    monthly_bias,
        'above_200d_sma':  above_200d,
        'above_200w_sma':  above_200w,
        'yearly_open':     round(yearly_open, 2),
        'quarterly_open':  round(quarterly_open, 2),
        'monthly_open':    round(monthly_open, 2),
        'current_price':   round(current_price, 2),
    }
