# ═══════════════════════════════════════════════════════════════════
# AlphaBot v2 — config
# 11-strategy pilot, Coinbase data feed, dry-run order execution
# ═══════════════════════════════════════════════════════════════════
import os
from pathlib import Path

# ── Multi-asset configuration ─────────────────────────────────────
ASSETS = {
    'BTC': {
        'symbol':                 'BTC-USD',
        'contract_size':          0.01,
        'fee_per_side':           0.0012,
        'volatility_multiplier':  1.0,
        'data_file_prefix':       'btcusdt',
        'tier_risk':              {1: 4.0, 2: 3.0, 3: 1.5},
        'active':                 True,
    },
    'ETH': {
        'symbol':                 'ETH-USD',
        'contract_size':          1.0,
        'fee_per_side':           0.0012,
        'volatility_multiplier':  1.4,
        'data_file_prefix':       'ethusdt',
        'tier_risk':              {1: 4.0, 2: 3.0, 3: 1.5},
        'active':                 False,
    },
}
ACTIVE_ASSET = 'BTC'

# ── Symbol & data (derived from ACTIVE_ASSET) ─────────────────────
SYMBOL       = ASSETS[ACTIVE_ASSET]['symbol']
SYMBOLS      = [SYMBOL]
PRIMARY_TF   = "h4"
TIMEFRAMES   = {"weekly": "1w", "daily": "1d", "h4": "4h", "h1": "1h"}
OHLCV_LIMIT  = 720

# ── Coinbase Exchange public endpoints (no auth needed for OHLCV) ──
COINBASE_REST_BASE  = "https://api.exchange.coinbase.com"
FUTURES_REST_BASE   = "https://api.coinbase.com/api/v3/brokerage/market"
COINBASE_GRANULARITY = {"1w": 86400*7, "1d": 86400, "4h": 14400, "1h": 3600}
# (Coinbase returns weekly via 6 * 1d candles; we resample if needed.)

# ── Coinbase trading (CFM nano-futures) — dry-run for pilot ───────
DRY_RUN                  = True            # if True, no real orders placed
COINBASE_API_KEY         = os.getenv("COINBASE_API_KEY",         "")
COINBASE_API_SECRET      = os.getenv("COINBASE_API_SECRET",      "")
COINBASE_API_PASSPHRASE  = os.getenv("COINBASE_API_PASSPHRASE",  "")
COINBASE_KEY_FILE        = os.getenv("COINBASE_KEY_FILE",        "")
NANO_BTC             = 0.01            # 1 nano contract = 0.01 BTC

# ── Risk model (shared with dashboard) ────────────────────────────
ACCOUNT_SIZE   = 1_000.0               # USD; updated as account grows
# Bet bigger when edge is stronger (T1 high WR, rare). Smaller on frequent/low-WR (T3).
# Targets have +wiggle so 1-contract integer rounding still fires on small accounts.
TIER_RISK_PCT  = {1: 4.0, 2: 3.0, 3: 1.5}   # % of equity per tier (capped by HARD_CAP_PCT)
TIER_RR        = {1: 3.0, 2: 2.5, 3: 2.0}
HARD_CAP_PCT   = 6.0                   # NEVER risk more than this per trade
DD_FILTER_PCT  = -10.0                 # pause tier-3 if portfolio DD <= this
DD_CIRCUIT_BREAKER = -15.0             # full bot pause if portfolio DD <= this
LOSS_STREAK_HALF_SIZE = 3             # after N losses in a row → half position size
LOSS_STREAK_PAUSE     = 5             # after N losses in a row → full pause + Telegram

# ── Conviction multiplier ──────────────────────────────────────────
# Tier 1 signals get 1.5x size when conditions are met (4% → 6%, at HARD_CAP_PCT)
CONVICTION_MULTIPLIER_ENABLED  = True  # master switch for CM
CONVICTION_LAST_WIN_ENABLED    = True  # Test B: also boost if last closed trade was a win

# ── Futures (Coinbase nano-BTC) leverage guard-rails ──────────────
# Daily contracts: 10x leverage → liquidation at 10% from entry
# Weekend contracts: 4x leverage → liquidation at 25% from entry
FUTURES_LEVERAGE        = {"daily": 10, "weekend": 4}
# T1b SL=10% = exactly at 10x liquidation level — never trade on daily futures
FUTURES_NO_10X          = {"T1b_W_rsi_os_long"}
# T1a SL=8%, T2b SL=8% → only 2% gap to liquidation — reduce size 50% on daily futures
FUTURES_WARN_10X        = {"T1a_W_fail_brkdn_long", "T2b_W_sweep_hi_short"}
# At 4x weekend, T3a (SL=1.2%) uses 62.5% of account as margin — skip on weekends
# T1d (SL=3%) uses 58% margin at 4x — skip on weekends
FUTURES_NO_WEEKEND      = {"T3a_H1_fail_brkdn_long", "T1d_H4_sweep_hi_short"}
FUTURES_MAX_MARGIN_PCT  = 40.0        # max % of account as margin for any single futures trade
FUTURES_MAX_OPEN        = 2           # max concurrent futures contracts
FUTURES_DAILY_CLOSE_ET  = "15:45"    # force-close daily contracts by this time (ET) — expiry at 16:00

# ── Indicator params (only what the 11 strats use) ────────────────
RSI_LEN     = 14
EMA_FAST    = 50
EMA_SLOW    = 200
ATR_LEN     = 14
VOL_MA_LEN  = 20
HI_LO_LEN   = 20

# ── Strategy registry (11 pilot strats) ───────────────────────────
# fields: tier, timeframe, direction, sl_pct, rr, horizon_bars, debounce_bars,
#         friendly name, plain English description
STRATEGIES = {
    # ---- Tier 1 — Elite (7% risk, 1.0x) — WR >= 70% or extreme edge ----
    "T1a_W_fail_brkdn_long":      dict(tier=1, tf="1w", side="long",  sl=0.08,  rr=3.0, horizon=12, gap=4,  name="Weekly A · Fake Crash Bounce (Buy)", desc="Price broke below a key low but recovered. The drop was a fakeout."),
    "T1b_W_rsi_os_long":          dict(tier=1, tf="1w", side="long",  sl=0.10,  rr=3.0, horizon=12, gap=3,  name="Weekly A · Deep Drop Bounce (Buy)",  desc="Price dropped so far it's exhausted. Bounce expected."),
    "T1c_D_sstar_short":          dict(tier=1, tf="1d", side="short", sl=0.05,  rr=3.0, horizon=35, gap=10, name="Daily A · Failed Top (Sell)",        desc="Price pushed to a new high but got rejected hard."),
    "T1d_H4_sweep_hi_short":      dict(tier=1, tf="4h", side="short", sl=0.03,  rr=3.0, horizon=60, gap=12, name="4-Hour A · Fake High Reversal (Sell)", desc="4-hour price poked above resistance briefly then came back."),
    # ---- Tier 2 — Solid (3% risk) — WR >= 40% + positive avg R ----
    "T2b_W_sweep_hi_short":       dict(tier=2, tf="1w", side="short", sl=0.08,  rr=2.5, horizon=10, gap=4,  name="Weekly B · Weekly Top Trap (Sell)",           desc="Weekly price spiked above a key high then snapped back."),
    "T2d_D_squeeze_brk_long":     dict(tier=2, tf="1d", side="long",  sl=0.03,  rr=2.67,horizon=15, gap=8,  name="Daily B · 3-Bar Squeeze Breakout (Buy)",     desc="Price coiled tight for 3 days then broke out above the range with volume. Energy release."),
    "T2e_W_mo_reclaim_long":      dict(tier=2, tf="1w", side="long",  sl=0.07,  rr=2.57,horizon=10, gap=3,  name="Weekly B · Monthly Open Reclaim (Buy)",      desc="Weekly price dipped below the monthly open but reclaimed it with volume. Monthly bias reasserting."),
    "T2g_D_bull_flag_long":       dict(tier=2, tf="1d", side="long",  sl=0.05,  rr=3.0, horizon=15, gap=8,  name="Daily B · Bull Flag Breakout (Buy)",          desc="5-day tight consolidation in an uptrend breaks out with volume. Classic continuation setup."),
    "T3c_W_5bar_low_long":        dict(tier=2, tf="1w", side="long",  sl=0.05,  rr=2.0, horizon=12, gap=2,  name="Weekly B · Multi-Week Low (Buy)",             desc="Price made a 5-week low then turned. Reversal expected."),
    # ---- T3a — H1 failed breakdown (highest-volume strategy, 112 trades, 56% WR) ----
    "T3a_H1_fail_brkdn_long":     dict(tier=2, tf="1h", side="long",  sl=0.012, rr=2.5, horizon=24, gap=4,  name="1-Hour B · H1 Fake Crash Bounce (Buy)",        desc="H1 price broke below the 20-bar low but recovered above it. Stop hunt on hourly absorbed — reversal setup."),
    # ---- New strategies (v6) — more trades, macro-gated ----
    "T_H4_sweep_lo_long":         dict(tier=2, tf="4h", side="long",  sl=0.03,  rr=3.0, horizon=60, gap=12, name="4-Hour B · Sweep Low Bounce (Buy)",            desc="H4 price briefly wicked below support then snapped back. Buyers absorbed the dip — classic stop hunt before reversal."),
    "T_W_ema50_dip_long":         dict(tier=2, tf="1w", side="long",  sl=0.06,  rr=2.5, horizon=10, gap=3,  name="Weekly B · EMA50 Dip Bounce (Buy)",             desc="Weekly price pulled back to the 50-week average and bounced with a green close. Classic bull market buy-the-dip setup."),
    "T_D_ema200_bounce_long":     dict(tier=2, tf="1d", side="long",  sl=0.05,  rr=2.5, horizon=20, gap=8,  name="Daily B · EMA200 Bounce (Buy)",                 desc="Daily candle wicked below the 200-day moving average but closed above it with above-average volume. Key support held."),
    # ---- New v7 strategies — sweep-based, same model as proven T1d/sweep_lo ----
    "T_H4_ema21_bounce_long":     dict(tier=2, tf="4h", side="long",  sl=0.025, rr=2.5, horizon=20, gap=8,  name="4-Hour B · EMA21 Bounce (Buy)",                 desc="DISABLED — 33% WR."),
    "T_D_2bar_pullback_long":     dict(tier=2, tf="1d", side="long",  sl=0.04,  rr=2.5, horizon=12, gap=5,  name="Daily B · 2-Bar Pullback (Buy)",                desc="DISABLED — 36% WR."),
    "T_D_sweep_lo_long":          dict(tier=2, tf="1d", side="long",  sl=0.05,  rr=3.0, horizon=20, gap=8,  name="Daily B · Sweep Low Bounce (Buy)",              desc="DISABLED — 10 trades, 30% WR, near-zero edge (+0.020R). Removed from Mix C."),
    "T_D_hi20_breakout_long":     dict(tier=2, tf="1d", side="long",  sl=0.04,  rr=2.5, horizon=15, gap=8,  name="Daily B · 20-Day High Breakout (Buy)",          desc="Daily close above the 20-day high with strong volume and momentum. Price discovery breakout — BTC in bull markets continues higher."),
}

# ── Telegram ──────────────────────────────────────────────────────
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN",   "YOUR_BOT_TOKEN_HERE")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "YOUR_CHAT_ID_HERE")

# ── Scheduler ─────────────────────────────────────────────────────
RUN_INTERVAL_MINUTES = 10
MORNING_BRIEF_LOCAL  = "10:00"     # UTC

# ── Paths (shared with dashboard) ─────────────────────────────────
BASE_DIR    = Path(__file__).resolve().parents[2]   # Claude AI/
STATE_FILE  = Path(__file__).resolve().parents[1] / f"state_{ACTIVE_ASSET.lower()}.json"
LEDGER_FILE = BASE_DIR / "btc-data" / f"trades_{ACTIVE_ASSET.lower()}.csv"
