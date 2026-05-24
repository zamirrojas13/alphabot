"""
AlphaBrain v1 — Configuration
All parameters structurally motivated, not curve-fitted.
"""

# ── System ────────────────────────────────────────────────────────────────────
BRAIN_ENABLED       = True
BRAIN_PAPER_ACCOUNT = 1000
BRAIN_RISK_PCT      = 0.03      # 3% risk per trade
BRAIN_HARD_CAP      = 0.06      # 6% max position size

# ── Level reaction parameters ─────────────────────────────────────────────────
LEVEL_TOUCH_THRESHOLD = 0.003   # 0.3% — price must come within this of level
LEVEL_MAX_DISTANCE    = 0.05    # 5%  — only watch levels within 5% of price
REJECTION_CLOSE_PCT   = 0.40    # close must be in top/bottom 40% of candle range
MIN_WICK_RATIO        = 2.0     # wick must be >= 2× body to count as rejection

# ── Target calculation ────────────────────────────────────────────────────────
GOAL_1_MULTIPLIER = 0.5         # 50% of prior week range
GOAL_2_MULTIPLIER = 1.0         # 100% of prior week range
GOAL_3_MULTIPLIER = 1.5         # 150% of prior week range

# ── Risk management ───────────────────────────────────────────────────────────
SL_BEYOND_LEVEL   = 0.008       # 0.8% beyond the level — v3: reverted, ATR gate guards entry instead

# ── Timeframe ─────────────────────────────────────────────────────────────────
SIGNAL_TIMEFRAME  = '4H'        # reaction detected on 4H candles

# ── Backtest ─────────────────────────────────────────────────────────────────
TIME_STOP_BARS    = 30          # exit if no TP/SL after 30 × 4H bars = 5 days
