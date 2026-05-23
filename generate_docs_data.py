"""
Generate docs/data.js from local btc-data/trades_btc.csv + state_btc.json.
Run from the alphabot/ directory.
"""
import json, sys
from pathlib import Path
from collections import defaultdict

import pandas as pd

ROOT        = Path(__file__).parent.parent
TRADES_CSV  = ROOT / "btc-data" / "backtest_v9_trades.csv"   # v9 official: 242 trades, $220k
STATE_JSON  = ROOT / "BTC BOT v2" / "state_btc.json"
OUT_DOCS    = Path(__file__).parent / "docs"  / "data.js"
OUT_STATIC  = Path(__file__).parent / "static" / "data.js"

START       = 10_000.0   # v9 backtest starting equity

STRAT_LABELS = {
    "T1a_W_fail_brkdn_long":       "Weekly · Failed Breakdown Recovery (Long)",
    "T1b_W_rsi_os_long":           "Weekly · Oversold RSI Bounce (Long)",
    "T1c_D_sstar_short":           "Daily · Shooting Star Reversal (Short)",
    "T1d_H4_sweep_hi_short":       "4H · High Sweep Rejection (Short)",
    "T1e_W_oversold_hammer_long":  "Weekly · Oversold Hammer (Long)",
    "T1f_H4_willy_rev_short":      "4H · Williams %R Reversal (Short)",
    "T1g_H4_vol_surge_long":       "4H · Volume Surge Breakout (Long)",
    "T1h_H4_vol_surge_short":      "4H · Volume Surge Breakdown (Short)",
    "T2a_D_hammer_long":           "Daily · Hammer Bounce (Long)",
    "T2b_W_sweep_hi_short":        "Weekly · High Sweep Fade (Short)",
    "T2c_W_bull_engulf_long":      "Weekly · Bullish Engulf (Long)",
    "T2d_H4_bear_div_short":       "4H · Bearish Divergence (Short)",
    "T2e_W_month_cross_long":      "Weekly · Monthly Open Cross (Long)",
    "T2g_D_flag_long":             "Daily · Bull Flag Breakout (Long)",
    "T3a_H1_fail_brkdn_long":      "1H · Stop-Hunt Recovery (Long)",
    "T3b_H4_sweep_hi_short_loose": "4H · Loose High Sweep (Short)",
    "T3c_W_5bar_low_long":         "Weekly · 5-Bar Low Reversal (Long)",
    "T_D_hi20":                    "Daily · 20-Day High Breakout (Long)",
    "T_D_ema200":                  "Daily · EMA200 Reclaim (Long)",
    "T_W_ema":                     "Weekly · EMA50 Pullback (Long)",
}

# ── Load trades (v9 backtest format) ──────────────────────────────────────────
print(f"Reading {TRADES_CSV} ...")
df = pd.read_csv(TRADES_CSV, low_memory=False)
print(f"  {len(df)} rows, columns: {list(df.columns[:8])} ...")

# v9 format: all rows are closed trades; normalize column names to match dashboard expectations
df_closed = df.copy()
df_closed["setup_type"]   = df_closed.get("strat", pd.Series(dtype=str))
df_closed["pnl_net_usd"]  = df_closed["acct_ret"] * df_closed["equity_prev"]  # dollar P&L
df_closed["timestamp_exit"] = df_closed["timestamp_entry"]  # v9 has no separate exit timestamp
df_closed["source"]        = "backtest_v9"
df_closed["venue"]         = "binance"
df_closed["symbol"]        = "BTCUSDT"
df_closed["grade"]         = df_closed["tier"].map({1:"A+", 2:"Solid", 3:"B"}).fillna("B")
df_closed["direction"]     = df_closed["direction"].map({1:"long",-1:"short"}).fillna("long")
df_closed["max_risk_usd"]  = df_closed["equity_prev"] * df_closed["tier"].map({1:0.04,2:0.03,3:0.015})
df_closed["atr"]           = df_closed["entry_price"] * df_closed["sl_pct"] / 1.5
df_closed["vol_ratio"]     = 1.4
df_closed["position_size_btc"] = 0.0
df_closed["nano_qty"]      = 0
df_closed["pnl_usd"]       = df_closed["pnl_net_usd"]
df_closed["fees_usd"]      = 0.0
df_closed["rr_target"]     = df_closed["tp_pct"] / df_closed["sl_pct"]
df_closed["primary_setup"] = df_closed["setup_type"].map(STRAT_LABELS).fillna(df_closed["setup_type"])
df_closed["notes"]         = df_closed["cm_trigger"].fillna("")
df_closed["d_rsi"]         = 50.0
df_closed["w_rsi"]         = 50.0
df_closed["daily_trend"]   = df_closed["direction"].map({"long":"bull","short":"bear"}).fillna("bull")
df_closed["weekly_trend"]  = df_closed["daily_trend"]

df_closed = df_closed.sort_values("timestamp_entry").reset_index(drop=True)
print(f"  Closed trades: {len(df_closed)}")

# ── Equity curve — use the pre-computed equity column from v9 ─────────────────
eq_pts = [{"t": int(pd.Timestamp("2017-01-01", tz="UTC").timestamp()*1000),
            "v": START, "label": "Start"}]
for _, row in df_closed.iterrows():
    ts = row["timestamp_entry"]
    try:
        t_ms = int(pd.Timestamp(ts).timestamp() * 1000)
    except:
        continue
    eq_pts.append({"t": t_ms, "v": round(float(row["equity"]), 2),
                   "label": str(row.get("strat",""))})

now_ms = int(pd.Timestamp.now(tz="UTC").timestamp()*1000)
final_from_eq = float(df_closed["equity"].iloc[-1])
eq_pts.append({"t": now_ms, "v": round(final_from_eq, 2), "label": "Now"})

max_dd = round(float(df_closed["dd"].min()), 2)

final_eq  = round(final_from_eq, 2)
total_net = round(final_eq - START, 2)
wins      = (df_closed["pnl_net_usd"] > 0).sum()
losses    = (df_closed["pnl_net_usd"] <= 0).sum()
total_n   = len(df_closed)
wr        = round(wins / total_n * 100, 1) if total_n else 0.0
total_r   = df_closed["r_multiple"].sum() if "r_multiple" in df_closed else 0
avg_r     = round(float(total_r) / total_n, 3) if total_n else 0.0
max_dd    = round(max_dd, 2)
ret_pct   = round((final_eq / START - 1) * 100, 2)

print(f"  Final equity: ${final_eq:,.2f}  WR: {wr}%  AvgR: {avg_r}  MaxDD: {max_dd}%")

# ── Setup stats ────────────────────────────────────────────────────────────────
setup_stats = defaultdict(lambda: {"w": 0, "l": 0})
for _, row in df_closed.iterrows():
    sid = str(row.get("setup_type","")).strip()
    if not sid: continue
    if float(row.get("pnl_net_usd") or 0) > 0:
        setup_stats[sid]["w"] += 1
    else:
        setup_stats[sid]["l"] += 1

ev_rows = []
for sid, sub in setup_stats.items():
    n  = sub["w"] + sub["l"]
    sub_df = df_closed[df_closed["setup_type"] == sid]
    wins_r   = sub_df[sub_df["r_multiple"] > 0]["r_multiple"].tolist()
    losses_r = sub_df[sub_df["r_multiple"] <= 0]["r_multiple"].abs().tolist()
    wr_s  = sub["w"] / n if n else 0
    avgW  = sum(wins_r)   / len(wins_r)   if wins_r   else 0
    avgL  = sum(losses_r) / len(losses_r) if losses_r else 0
    ev    = wr_s * avgW - (1 - wr_s) * avgL
    label = STRAT_LABELS.get(sid, sid)
    ev_rows.append({"type": label, "sid": sid, "wr": round(wr_s,3),
                    "avgW": round(avgW,2), "avgL": round(avgL,2),
                    "ev": round(ev,3), "total": n,
                    "w": sub["w"], "l": sub["l"]})

# ── Daily PnL heatmap (last 30 days) ──────────────────────────────────────────
daily_map = defaultdict(float)
for _, row in df_closed.iterrows():
    d = str(row.get("timestamp_exit",""))[:10]
    daily_map[d] += float(row.get("pnl_net_usd") or 0)
ts_now = pd.Timestamp.now(tz="UTC")
days30 = [(ts_now - pd.Timedelta(days=i)).strftime("%Y-%m-%d") for i in range(29,-1,-1)]
daily_pnl = {d: round(daily_map.get(d,0.0),2) for d in days30}

# ── Hourly stats ──────────────────────────────────────────────────────────────
hour_stats = []
for h in [0, 4, 8, 12, 16, 20]:
    def safe_hour(ts):
        try: return pd.Timestamp(ts).hour
        except: return -1
    sub = df_closed[df_closed["timestamp_entry"].apply(safe_hour) == h]
    w   = int((sub["pnl_net_usd"] > 0).sum())
    l   = int((sub["pnl_net_usd"] <= 0).sum())
    avg_r_h = round(float(sub["r_multiple"].mean()), 2) if len(sub) else 0
    hour_stats.append({"hour":h,"label":f"{h:02d}:00","wins":w,"losses":l,"avg_r":avg_r_h})

# ── Day-of-week stats ─────────────────────────────────────────────────────────
dow_map  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
dow_stats = []
def safe_dow(ts):
    try: return pd.Timestamp(ts).dayofweek
    except: return -1
for i, d in enumerate(dow_map):
    sub = df_closed[df_closed["timestamp_entry"].apply(safe_dow) == i]
    w   = int((sub["pnl_net_usd"] > 0).sum())
    l   = int((sub["pnl_net_usd"] <= 0).sum())
    total_r_d = round(float(sub["r_multiple"].sum()), 2) if len(sub) else 0
    dow_stats.append({"day":d,"wins":w,"losses":l,"total_r":total_r_d})

# ── Build TRADES list (most recent first) ─────────────────────────────────────
def safe(val, cast=float, default=None):
    if val is None or (isinstance(val, float) and pd.isna(val)): return default
    try: return cast(val)
    except: return default

trades_list = []
for i, row in df_closed.sort_values("timestamp_exit", ascending=False).head(500).iterrows():
    sid   = str(row.get("setup_type","")).strip()
    label = STRAT_LABELS.get(sid, sid)
    trades_list.append({
        "trade_id":          str(row.get("trade_id", f"BTC-{i:03d}")),
        "source":            str(row.get("source","backtest")),
        "venue":             str(row.get("venue","binance")),
        "symbol":            str(row.get("symbol","BTCUSDT")),
        "timeframe":         str(row.get("timeframe","1h")),
        "timestamp_entry":   str(row.get("timestamp_entry","")),
        "timestamp_exit":    str(row.get("timestamp_exit","")),
        "direction":         str(row.get("direction","long")),
        "setup_type":        label,
        "setup_id":          sid,
        "primary_setup":     str(row.get("primary_setup", label)),
        "tier":              safe(row.get("tier",3), int, 3),
        "grade":             str(row.get("grade","B")),
        "entry_price":       safe(row.get("entry_price"),float,0),
        "sl_price":          safe(row.get("sl_price"),float,0),
        "tp_price":          safe(row.get("tp_price"),float,0),
        "rr_target":         safe(row.get("rr_target",2.0),float,2.0),
        "max_risk_usd":      safe(row.get("max_risk_usd"),float,0),
        "position_size_btc": safe(row.get("position_size_btc"),float,0),
        "nano_qty":          safe(row.get("nano_qty"),int,0),
        "exit_price":        safe(row.get("exit_price"),float,None),
        "exit_reason":       str(row.get("exit_reason","")) if row.get("exit_reason") else None,
        "bars_held":         safe(row.get("bars_held"),int,0),
        "pnl_usd":           safe(row.get("pnl_usd"),float,None),
        "pnl_net_usd":       safe(row.get("pnl_net_usd"),float,None),
        "pnl_pct":           safe(row.get("pnl_pct"),float,None),
        "r_multiple":        safe(row.get("r_multiple"),float,None),
        "fees_usd":          safe(row.get("fees_usd"),float,None),
        "atr":               safe(row.get("atr"),float,0),
        "vol_ratio":         safe(row.get("vol_ratio"),float,1.0),
        "d_rsi":             safe(row.get("d_rsi"),float,50),
        "w_rsi":             safe(row.get("w_rsi"),float,50),
        "daily_trend":       str(row.get("daily_trend","bull")),
        "weekly_trend":      str(row.get("weekly_trend","bull")),
        "open":              False,
        "notes":             str(row.get("notes","")) if row.get("notes") else "",
    })

# ── State ─────────────────────────────────────────────────────────────────────
state_raw = {}
if STATE_JSON.exists():
    try: state_raw = json.loads(STATE_JSON.read_text())
    except: pass

ACCOUNT = {"equity": final_eq, "buying_power": final_eq,
           "cash": final_eq, "account_size": START}
OPEN_POSITION = {"symbol":"BTC/USD","qty":0,"avg_entry_price":0,
                 "current_price":0,"unrealized_pl":0,"unrealized_plpc":0,"side":"long"}
BOT_STATE = {
    "loss_streak":         state_raw.get("loss_streak", 0),
    "tier_restricted":     bool(state_raw.get("tier3_paused", False)),
    "portfolio_dd_pct":    round(max_dd, 2),
    "tier3_paused":        bool(state_raw.get("tier3_paused", False)),
    "last_signal_bar":     state_raw.get("last_signal_bar"),
    "last_daily_scan_day": state_raw.get("last_daily_scan_day"),
    "trade_pending":       bool(state_raw.get("trade_pending", False)),
    "active_trade": {
        "trade_id":"—","direction":"long","setup_type":"—",
        "tier":1,"grade":"B","entry_price":0,"sl_price":0,
        "tp_price":0,"rr_target":0,"max_risk_usd":0,"qty":0,"timestamp_entry":None,
    },
}
CONFIG = {
    "SYMBOL":"BTC/USD","PRIMARY_TF":"h4","OHLCV_LIMIT":720,
    "EMA_FAST":50,"EMA_SLOW":200,"ATR_LEN":14,"RSI_LEN":14,
    "ACCOUNT_SIZE": START,
    "TIER_RISK_PCT":{"1":4.0,"2":3.0,"3":1.5},
    "TIER_RR":{"1":3.0,"2":2.5,"3":2.0},
    "TIER_RISK":{"1":40.0,"2":30.0,"3":15.0},
    "DD_FILTER_PCT":-15,"DD_FILTER_PAUSES_TIER":3,
    "VOL_SPIKE_MULT":1.2,"SWING_BARS":20,
    "TIME_EXIT_WEEKLY":12,"TIME_EXIT_DAILY":25,"TIME_EXIT_H4":40,"TIME_EXIT_H1":48,
    "RUN_INTERVAL_MINUTES":15,"MORNING_BRIEF_LOCAL":"10:00",
}

# ── Grades ────────────────────────────────────────────────────────────────────
grade_counts = {"A+": 0, "Solid": 0, "B": 0}
for _, row in df_closed.iterrows():
    g = str(row.get("grade","B"))
    if g in grade_counts: grade_counts[g] += 1

# ── Render JS ─────────────────────────────────────────────────────────────────
generated = pd.Timestamp.now().strftime("%Y-%m-%d %H:%M")
js = f"""// AlphaBot — generated from local btc-data/trades_btc.csv
// Generated: {generated} UTC
// Trades: {len(df_closed)}  ·  Account: ${final_eq:,.2f}  ·  CAGR est from backtest

const ACCOUNT       = {json.dumps(ACCOUNT, indent=2)};
const OPEN_POSITION = {json.dumps(OPEN_POSITION)};
const BOT_STATE     = {json.dumps(BOT_STATE, indent=2)};
const CONFIG        = {json.dumps(CONFIG, indent=2)};
const TRADES        = {json.dumps(trades_list, indent=2)};
const LAST_SIGNAL   = {{
  "bar_time": null, "price": 0, "direction": "long", "setup_type": "—",
  "tier": 1, "grade": "B", "ema_fast": 0, "ema_slow": 0, "atr_val": 0,
  "sl": 0, "tp": 0, "rr": 0, "max_risk": 0, "qty": 0, "nano_qty": 0,
  "alignment": {{"weekly_ok": false, "daily_ok": false, "h4_ok": false}},
  "conditions": {{"trend": false, "pattern": false, "extreme": false, "cnt": 0}},
  "weekly_close": 0, "weekly_ema50": 0, "h4_uptrend": false, "uptrend": false
}};
const TELEGRAM_MSGS = [];
const EQUITY_CURVE  = {json.dumps(eq_pts)};
const STATS = {{
  total_trades:  {len(df_closed)},
  closed_trades: {len(df_closed)},
  wins:          {int(wins)},
  losses:        {int(losses)},
  win_rate:      {wr},
  avg_r:         {avg_r},
  total_r:       {round(float(total_r),2)},
  total_net_pnl: {total_net},
  max_drawdown:  {max_dd},
  grades:        {json.dumps(grade_counts)},
  setupStats:    {json.dumps(dict(setup_stats))},
  pnl_today:     0,
  pnl_week:      0,
  return_pct:    {ret_pct}
}};
const CANDLES       = [];
const DAILY_PNL     = {json.dumps(daily_pnl)};
const HOURLY_STATS  = {json.dumps(hour_stats)};
const DOW_STATS     = {json.dumps(dow_stats)};
const KEY_LEVELS    = [];
const TAG_OPTIONS   = ["weekly","daily","h4","h1","long","short","tier1","tier2","tier3"];
const EV_BY_SETUP   = {json.dumps(ev_rows, indent=2)};
const SESSION_DD    = [];
const STRAT_LABELS  = {json.dumps(STRAT_LABELS, indent=2)};

const MOCK = {{
  account: ACCOUNT, position: OPEN_POSITION, bot_state: BOT_STATE, config: CONFIG,
  trades: TRADES, last_signal: LAST_SIGNAL, telegram: TELEGRAM_MSGS,
  equity: EQUITY_CURVE, stats: STATS, candles: CANDLES,
  daily_pnl: DAILY_PNL, hourly_stats: HOURLY_STATS, dow_stats: DOW_STATS,
  key_levels: KEY_LEVELS, tag_options: TAG_OPTIONS,
  ev_by_setup: EV_BY_SETUP, session_dd: SESSION_DD,
  strat_labels: STRAT_LABELS,
}};
"""

for out in [OUT_DOCS, OUT_STATIC]:
    out.write_text(js, encoding="utf-8")
    print(f"Wrote {out}")

print(f"\nDone. {len(df_closed)} trades | ${final_eq:,.2f} equity | {wr}% WR | {avg_r:+.3f}R avg | {max_dd}% maxDD")
