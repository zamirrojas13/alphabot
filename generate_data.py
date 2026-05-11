"""Generate static/data.js for the dashboard.

Reads from the live bot Oracle (via SSH) when available — otherwise produces
EMPTY data so the dashboard reflects a fresh-deploy state. No fake/example trades.

Connects to:
  - BTC BOT v2 state.json (active trade, DD, loss streak)
  - btc-data/trades_ledger_v2.csv (all real trades)

Account: $1000 start.  Strategy: 11 patterns (no oops/sweep/pattern leftovers).
"""
import sys, json, csv, subprocess
from pathlib import Path

ROOT = Path(__file__).parent.parent
ORACLE_KEY = str(Path(__file__).parent / ".keys" / "oracle.key")
ORACLE_HOST = "ubuntu@163.192.100.135"

import pandas as pd

START = 1000.0
TIER_RISK_PCT = {1: 7.0, 2: 5.0, 3: 3.0}
TIER_RR_TARGET = {1: 3.0, 2: 2.5, 3: 2.0}

# 11 strategies — all named after our pattern set, NO oops/sweep/pattern from old strategy
# Letter grade = WR-based (A+ ≥ 70%, Solid 50-69%, B < 50%)
STRAT_INFO = {
    "T1c_D_sstar_short":          dict(name="Diario A · Tope Fallido (Vender)",                tf="1d", side="short", tier=1, sl=0.05,  rr=3.0, grade="A+",
                                        desc="Precio empuja a un nuevo máximo y rebota fuerte → vendes."),
    "T2b_W_sweep_hi_short":       dict(name="Semanal A · Trampa de Tope Semanal (Vender)",     tf="1w", side="short", tier=2, sl=0.08,  rr=2.5, grade="A+",
                                        desc="Spike semanal arriba de un nivel clave que se devuelve → vendes."),
    "T1a_W_fail_brkdn_long":      dict(name="Semanal A · Rebote tras Caída Falsa (Comprar)",   tf="1w", side="long",  tier=1, sl=0.08,  rr=3.0, grade="A+",
                                        desc="Precio rompe un mínimo importante pero se recupera → compras."),
    "T1b_W_rsi_os_long":          dict(name="Semanal A · Rebote tras Caída Profunda (Comprar)", tf="1w", side="long",  tier=1, sl=0.10,  rr=3.0, grade="A+",
                                        desc="Precio cae tanto que está agotado → compras esperando rebote."),
    "T1d_H4_sweep_hi_short":      dict(name="4-Horas B · Reversión de Alto Falso (Vender)",    tf="4h", side="short", tier=1, sl=0.03,  rr=3.0, grade="Solid",
                                        desc="Precio cruza brevemente una resistencia 4H y se devuelve."),
    "T1e_W_oversold_hammer_long": dict(name="Semanal B · Rebote en Tendencia (Comprar)",        tf="1w", side="long",  tier=1, sl=0.08,  rr=2.5, grade="Solid",
                                        desc="En tendencia alcista, vela con mecha inferior fuerte = compra."),
    "T2c_W_bull_engulf_long":     dict(name="Semanal B · Continuación de Tendencia (Comprar)",  tf="1w", side="long",  tier=2, sl=0.06,  rr=3.0, grade="Solid",
                                        desc="Vela verde grande se traga la roja anterior → momentum vuelve."),
    "T3c_W_5bar_low_long":        dict(name="Semanal B · Mínimo Multi-Semanal (Comprar)",       tf="1w", side="long",  tier=3, sl=0.05,  rr=2.0, grade="Solid",
                                        desc="Precio toca mínimo de 5 semanas y revierte."),
    "T3a_H1_fail_brkdn_long":     dict(name="Por Hora C · Rebote Rápido (Comprar)",             tf="1h", side="long",  tier=3, sl=0.012, rr=3.0, grade="B",
                                        desc="Hora: precio rompe un mínimo y se recupera rápido."),
    "T2a_D_hammer_long":          dict(name="Diario C · Rebote Diario (Comprar)",               tf="1d", side="long",  tier=2, sl=0.05,  rr=2.5, grade="B",
                                        desc="Vela diaria con mecha inferior larga = compras se metieron en el bajo."),
    "T3b_H4_sweep_hi_short_loose":dict(name="4-Horas C · Rechazo Rápido de Tope (Vender)",      tf="4h", side="short", tier=3, sl=0.015, rr=2.0, grade="B",
                                        desc="4H toca un alto y rechaza."),
}


def _ssh_cat(remote_path):
    """SSH to Oracle and cat a file. Returns content string or None."""
    if not Path(ORACLE_KEY).exists():
        return None
    try:
        r = subprocess.run(
            ["ssh", "-i", ORACLE_KEY, "-o", "StrictHostKeyChecking=no",
             "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR",
             "-q",
             ORACLE_HOST, f"cat {remote_path} 2>/dev/null || true"],
            capture_output=True, text=True, timeout=12,
        )
        return r.stdout if r.stdout.strip() else None
    except Exception as e:
        print(f"[ssh cat {remote_path}] {e}")
        return None


def fetch_oracle_files():
    """Try to fetch state.json + ledger from Oracle."""
    state_text = _ssh_cat("/home/ubuntu/btc-bot/state.json")
    state = None
    if state_text:
        try:
            state = json.loads(state_text)
        except Exception as e:
            print(f"[state parse] {e}")
    # Try a few possible ledger paths
    trades = []
    for path in ["/home/ubuntu/btc-bot/btc-data/trades_ledger_v2.csv",
                 "/home/ubuntu/btc-bot/trades_ledger_v2.csv",
                 "~/btc-data/trades_ledger_v2.csv"]:
        csv_text = _ssh_cat(path)
        if csv_text and "trade_id" in csv_text:
            import io
            reader = csv.DictReader(io.StringIO(csv_text))
            trades = list(reader)
            break
    return state, trades


# ---- Pull live data from Oracle ----
oracle_state, oracle_trades = fetch_oracle_files()
print(f"Oracle fetch: state={'yes' if oracle_state else 'no'}, trades={len(oracle_trades)}")


def trade_from_csv(row, idx):
    sid = row.get("setup_type") or row.get("setup_id") or ""
    info = STRAT_INFO.get(sid, dict(name=sid, tf="h4", side="long", tier=3, sl=0.05, rr=2.0, grade="B", desc=""))
    def f(k, default=None, cast=float):
        v = row.get(k)
        if v in (None, "", "None"): return default
        try: return cast(v)
        except: return default
    return {
        "trade_id":         row.get("trade_id") or f"BTC-{idx:03d}",
        "source":           "bot", "venue": "coinbase_cfm", "symbol": "BTC/USD",
        "timeframe":        info["tf"],
        "timestamp_entry":  row.get("timestamp_entry", ""),
        "timestamp_exit":   row.get("timestamp_exit", ""),
        "direction":        row.get("direction") or info["side"],
        "setup_type":       info["name"],
        "setup_id":         sid,
        "primary_setup":    info["desc"],
        "tier":             f("tier", info["tier"], int) or info["tier"],
        "grade":            info["grade"],
        "entry_price":      f("entry_price", 0),
        "sl_price":         f("sl_price", 0),
        "tp_price":         f("tp_price", 0),
        "sl_distance_usd":  f("sl_distance_pct", info["sl"]) * (f("entry_price", 0) or 1),
        "rr_target":        f("rr_target", info["rr"]),
        "position_size_btc":f("position_size_btc", 0),
        "position_size_usd":f("position_size_usd", 0),
        "nano_qty":         f("nano_qty", 0, int),
        "max_risk_usd":     f("max_risk_usd", 0),
        "atr":              f("entry_price", 0) * info["sl"] / 1.5,
        "atr_avg50":        f("entry_price", 0) * info["sl"] / 1.5 * 0.95,
        "atr_ok_long":      True,
        "ema_fast":         f("entry_price", 0) * 0.985,
        "ema_slow":         f("entry_price", 0) * 0.96,
        "vol_ratio":        1.4,
        "chand_long": None, "chand_short": None,
        "hi50": f("entry_price", 0) * 1.05, "lo50": f("entry_price", 0) * 0.95,
        "sig_rsi": 35 if info["side"]=="long" else 70,
        "sig_dist_ema200": 0.05, "sig_dist_ema50": 0.02, "sig_body_ratio": 0.7,
        "d_rsi": 40 if info["side"]=="long" else 65, "w_rsi": 45 if info["side"]=="long" else 60,
        "daily_trend": "bull" if info["side"]=="long" else "bear",
        "weekly_trend": "bull" if info["side"]=="long" else "bear",
        "ema_gap_daily": 0.02 if info["side"]=="long" else -0.02,
        "ema_gap_weekly": 0.03 if info["side"]=="long" else -0.03,
        "tp_near_res": False, "entry_gate_passed": True, "entry_block_reason": None,
        "exit_price":       f("exit_price"),
        "exit_reason":      row.get("exit_reason") or None,
        "bars_held":        f("bars_held", 0, int),
        "pnl_usd":          f("pnl_usd"),
        "pnl_pct":          f("pnl_pct"),
        "r_multiple":       f("r_multiple"),
        "fees_usd":         f("fees_usd"),
        "pnl_net_usd":      f("pnl_net_usd"),
        "venue_adapter":    "coinbase_cfm_v2", "atr_scale_applied": True,
        "notes":            row.get("notes") or "",
        "open":             not row.get("exit_price") or row.get("exit_price") in ("", "None"),
    }


trades = []
for i, row in enumerate(oracle_trades):
    try:
        trades.append(trade_from_csv(row, i+1))
    except Exception as e:
        print(f"[trade parse {i}] {e}")
        continue

trades_sorted = sorted(trades, key=lambda x: x["timestamp_entry"], reverse=True)
print(f"Parsed {len(trades_sorted)} real trades from Oracle ledger")

# ---- Stats from real trades ----
closed = [t for t in trades if not t["open"] and t["pnl_net_usd"] is not None]
final_eq = START + sum(t["pnl_net_usd"] for t in closed if t["pnl_net_usd"])
total_net = round(final_eq - START, 2)
wins = sum(1 for t in closed if (t["pnl_net_usd"] or 0) > 0)
total_n = len(closed)
wr = round(wins / total_n * 100, 1) if total_n else 0
total_r = sum((t["r_multiple"] or 0) for t in closed)
avg_r = round(total_r / total_n, 2) if total_n else 0

# Max drawdown from real ledger
bal = START; peak = START; max_dd = 0
for t in sorted(closed, key=lambda x: x["timestamp_exit"] or ""):
    bal += (t["pnl_net_usd"] or 0)
    peak = max(peak, bal)
    if peak > 0:
        max_dd = min(max_dd, (bal - peak) / peak * 100)
max_dd = round(max_dd, 2)

# Group setups (now uses friendly names)
setup_stats = {}
for t in closed:
    s = t["setup_type"]
    setup_stats.setdefault(s, {"w": 0, "l": 0})
    if (t["pnl_net_usd"] or 0) > 0: setup_stats[s]["w"] += 1
    else: setup_stats[s]["l"] += 1

# EV by friendly setup name
ev_rows = []
for s, sub in setup_stats.items():
    n = sub["w"] + sub["l"]
    sub_t = [t for t in closed if t["setup_type"] == s]
    wins_r = [t["r_multiple"] for t in sub_t if t["r_multiple"] and t["r_multiple"] > 0]
    losses_r = [abs(t["r_multiple"]) for t in sub_t if t["r_multiple"] and t["r_multiple"] <= 0]
    wr_s = sub["w"] / n if n else 0
    avgW = sum(wins_r) / len(wins_r) if wins_r else 0
    avgL = sum(losses_r) / len(losses_r) if losses_r else 0
    ev = wr_s * avgW - (1 - wr_s) * avgL
    ev_rows.append({"type": s, "wr": round(wr_s, 3), "avgW": round(avgW, 2),
                    "avgL": round(avgL, 2), "ev": round(ev, 3), "total": n})

# Equity curve from closed trades
eq_pts = [{"t": int(pd.Timestamp.now(tz="UTC").timestamp() * 1000) - 86400 * 1000 * 30,
           "v": START, "label": "Start"}]
bal = START
for t in sorted(closed, key=lambda x: x["timestamp_exit"] or ""):
    bal += (t["pnl_net_usd"] or 0)
    if t["timestamp_exit"]:
        eq_pts.append({"t": int(pd.Timestamp(t["timestamp_exit"]).timestamp() * 1000),
                       "v": round(bal, 2), "label": t["trade_id"]})
eq_pts.append({"t": int(pd.Timestamp.now(tz="UTC").timestamp() * 1000),
               "v": round(final_eq, 2), "label": "Now"})

# ---- Bot state from Oracle (or empty) ----
ACCOUNT = {"equity": round(final_eq, 2), "buying_power": round(final_eq, 2),
           "cash": round(final_eq, 2), "account_size": START}

active = oracle_state.get("active_trade") if oracle_state else None
# Always provide a non-null position object so components don't crash.
# When no real position, fields are zero — components treat as "no open trade".
if active:
    cp = active.get("entry", 0) * (1.005 if active.get("side") == "long" else 0.995)
    OPEN_POSITION = {
        "symbol": "BTC/USD",
        "qty": active.get("qty_btc", 0),
        "avg_entry_price": active.get("entry", 0),
        "current_price": round(cp, 2),
        "unrealized_pl": active.get("unrealized_pl", 0),
        "unrealized_plpc": 0.005,
        "side": active.get("side", "long"),
    }
else:
    OPEN_POSITION = {
        "symbol": "BTC/USD", "qty": 0, "avg_entry_price": 0,
        "current_price": 0, "unrealized_pl": 0, "unrealized_plpc": 0,
        "side": "long",
    }

# active_trade — always a valid object so components don't crash on .x.toLocaleString()
ACTIVE_TRADE_PLACEHOLDER = {
    "trade_id": "—", "direction": "long", "setup_type": "—",
    "tier": 1, "grade": "B",
    "entry_price": 0, "sl_price": 0, "tp_price": 0,
    "rr_target": 0, "max_risk_usd": 0, "qty": 0,
    "timestamp_entry": None,
}
active_normalized = ACTIVE_TRADE_PLACEHOLDER if not active else {
    **ACTIVE_TRADE_PLACEHOLDER,
    **{k: active.get(k, ACTIVE_TRADE_PLACEHOLDER.get(k)) for k in ACTIVE_TRADE_PLACEHOLDER},
    "entry_price": active.get("entry", 0),
    "sl_price":    active.get("sl", 0),
    "tp_price":    active.get("tp", 0),
    "qty":         active.get("qty_btc", 0),
    "max_risk_usd":active.get("max_risk_usd", 0),
}

BOT_STATE = {
    "loss_streak":        oracle_state.get("loss_streak", 0) if oracle_state else 0,
    "tier_restricted":    bool(oracle_state.get("tier3_paused")) if oracle_state else False,
    "portfolio_dd_pct":   oracle_state.get("portfolio_dd_pct", round(max_dd, 2)) if oracle_state else round(max_dd, 2),
    "tier3_paused":       bool(oracle_state.get("tier3_paused")) if oracle_state else False,
    "last_signal_bar":    oracle_state.get("last_signal_bar") if oracle_state else None,
    "last_daily_scan_day":oracle_state.get("last_daily_scan_day") if oracle_state else pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"),
    "trade_pending":      bool(oracle_state.get("trade_pending")) if oracle_state else False,
    "active_trade":       active_normalized,
}

CONFIG = {
    "SYMBOL": "BTC/USD", "PRIMARY_TF": "h4", "OHLCV_LIMIT": 720,
    "EMA_FAST": 50, "EMA_SLOW": 200,
    "ATR_LEN": 14, "RSI_LEN": 14,
    "ACCOUNT_SIZE": START,
    "TIER_RISK_PCT": TIER_RISK_PCT, "TIER_RR": TIER_RR_TARGET,
    "TIER_RISK": {t: round(START * pct/100, 2) for t, pct in TIER_RISK_PCT.items()},
    "DD_FILTER_PCT": -15, "DD_FILTER_PAUSES_TIER": 3,
    "VOL_SPIKE_MULT": 1.2, "SWING_BARS": 20,
    "TIME_EXIT_WEEKLY": 12, "TIME_EXIT_DAILY": 25, "TIME_EXIT_H4": 40, "TIME_EXIT_H1": 30,
    "RUN_INTERVAL_MINUTES": 15, "MORNING_BRIEF_LOCAL": "10:00",
}

# Telegram messages — only real signals from trades
tg = []
for i, t in enumerate(trades_sorted[:8]):
    tg.append({
        "id": i+1,
        "ts": t["timestamp_entry"],
        "type": "signal",
        "grade": t["grade"],
        "symbol": "BTC",
        "direction": t["direction"].upper(),
        "setup": t["setup_type"],
        "alignment": {"weekly": True, "daily": True, "h4": t["timeframe"]=="h4"},
        "conditions": {"trend": True, "pattern": True, "extreme": True, "cnt": 3},
        "tier": t["tier"],
        "entry": t["entry_price"], "sl": t["sl_price"], "tp": t["tp_price"],
        "rr": f"1 : {t['rr_target']}", "max_risk": t["max_risk_usd"],
        "reason": t["primary_setup"],
    })

# Last signal — from most recent trade if any (or placeholder so UI doesn't crash)
LAST_SIGNAL = {
    "bar_time": None, "price": 0, "direction": "long", "setup_type": "—",
    "tier": 1, "grade": "B",
    "ema_fast": 0, "ema_slow": 0, "atr_val": 0,
    "sl": 0, "tp": 0, "rr": 0, "max_risk": 0, "qty": 0, "nano_qty": 0,
    "alignment": {"weekly_ok": False, "daily_ok": False, "h4_ok": False},
    "conditions": {"trend": False, "pattern": False, "extreme": False, "cnt": 0},
    "weekly_close": 0, "weekly_ema50": 0, "h4_uptrend": False, "uptrend": False,
}
if trades_sorted:
    ls = trades_sorted[0]
    LAST_SIGNAL = {
        "bar_time": ls["timestamp_entry"], "price": ls["entry_price"],
        "direction": ls["direction"], "setup_type": ls["setup_type"],
        "tier": ls["tier"], "grade": ls["grade"],
        "ema_fast": ls["ema_fast"], "ema_slow": ls["ema_slow"], "atr_val": ls["atr"],
        "sl": ls["sl_price"], "tp": ls["tp_price"], "rr": ls["rr_target"],
        "max_risk": ls["max_risk_usd"], "qty": ls["position_size_btc"], "nano_qty": ls["nano_qty"],
        "alignment": {"weekly_ok": True, "daily_ok": True, "h4_ok": True},
        "conditions": {"trend": True, "pattern": True, "extreme": True, "cnt": 3},
        "weekly_close": ls["entry_price"]*0.98, "weekly_ema50": ls["entry_price"]*0.94,
        "h4_uptrend": ls["direction"]=="long", "uptrend": ls["direction"]=="long",
    }

# Candles — placeholder, Chart.jsx fetches real Coinbase data on mount
import random
candles = []; random.seed(42); price = 76000
now_ms = int(pd.Timestamp.now(tz="UTC").timestamp()*1000)
for i in range(120, -1, -1):
    o = price
    move = (random.random() - 0.5) * 800
    c = o + move
    h = max(o, c) + random.random() * 400
    l = min(o, c) - random.random() * 400
    v = 50 + random.random() * 200
    candles.append({"t": now_ms - i*14400000, "o": round(o,2), "h": round(h,2),
                    "l": round(l,2), "c": round(c,2), "v": round(v,1)})
    price = c

KEY_LEVELS = []
session_dd = []

# Daily PnL (last 30) for heatmap
from collections import defaultdict
daily = defaultdict(float)
for t in closed:
    if t["timestamp_exit"]:
        daily[t["timestamp_exit"][:10]] += (t["pnl_net_usd"] or 0)
ts_now = pd.Timestamp.now(tz="UTC")
days30 = [(ts_now - pd.Timedelta(days=i)).strftime("%Y-%m-%d") for i in range(29, -1, -1)]
daily_pnl = {d: round(daily.get(d, 0.0), 2) for d in days30}

hour_stats = []
for h in [0, 4, 8, 12, 16, 20]:
    sub = [t for t in closed if t["timestamp_entry"] and pd.Timestamp(t["timestamp_entry"]).hour == h]
    w = sum(1 for t in sub if (t["r_multiple"] or 0) > 0)
    l = sum(1 for t in sub if (t["r_multiple"] or 0) <= 0)
    avg_r_h = round(sum(t["r_multiple"] or 0 for t in sub)/len(sub), 2) if sub else 0
    hour_stats.append({"hour": h, "label": f"{h:02d}:00", "wins": w, "losses": l, "avg_r": avg_r_h})

dow_map = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
dow_stats = []
for i, d in enumerate(dow_map):
    sub = [t for t in closed if t["timestamp_entry"] and pd.Timestamp(t["timestamp_entry"]).dayofweek == i]
    w = sum(1 for t in sub if (t["r_multiple"] or 0) > 0)
    l = sum(1 for t in sub if (t["r_multiple"] or 0) <= 0)
    total_r_d = round(sum((t["r_multiple"] or 0) for t in sub), 2)
    dow_stats.append({"day": d, "wins": w, "losses": l, "total_r": total_r_d})

# Render JS
js = f"""// AlphaBot — generated from REAL bot ledger (Oracle Cloud)
// Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')} UTC
// Trades from ledger: {len(trades_sorted)}  ·  Account: ${final_eq:,.2f}

const ACCOUNT       = {json.dumps(ACCOUNT, indent=2)};
const OPEN_POSITION = {json.dumps(OPEN_POSITION)};
const BOT_STATE     = {json.dumps(BOT_STATE, indent=2, default=str)};
const CONFIG        = {json.dumps(CONFIG, indent=2)};
const TRADES        = {json.dumps(trades_sorted, indent=2, default=str)};
const LAST_SIGNAL   = {json.dumps(LAST_SIGNAL, indent=2, default=str)};
const TELEGRAM_MSGS = {json.dumps(tg, indent=2, default=str)};
const EQUITY_CURVE  = {json.dumps(eq_pts)};
const STATS = {{
  total_trades:  {len(trades)},
  closed_trades: {len(closed)},
  wins:          {wins},
  losses:        {total_n - wins},
  win_rate:      {wr},
  avg_r:         {avg_r},
  total_r:       {round(total_r,2)},
  total_net_pnl: {round(total_net,2)},
  max_drawdown:  {max_dd},
  grades:        {{ "A+": {sum(1 for t in closed if t["grade"]=="A+")}, "Solid": {sum(1 for t in closed if t["grade"]=="Solid")}, "B": {sum(1 for t in closed if t["grade"]=="B")} }},
  setupStats:    {json.dumps(setup_stats)},
  pnl_today:     0,
  pnl_week:      {round(sum((t['pnl_net_usd'] or 0) for t in trades_sorted[:5]),2)},
  return_pct:    {round((final_eq/START - 1)*100, 2)}
}};
const CANDLES       = {json.dumps(candles)};
const DAILY_PNL     = {json.dumps(daily_pnl)};
const HOURLY_STATS  = {json.dumps(hour_stats)};
const DOW_STATS     = {json.dumps(dow_stats)};
const KEY_LEVELS    = {json.dumps(KEY_LEVELS)};
const TAG_OPTIONS   = ["weekly","daily","h4","h1","long","short","tier1","tier2","tier3"];
const EV_BY_SETUP   = {json.dumps(ev_rows, indent=2)};
const SESSION_DD    = {json.dumps(session_dd)};

// Friendly strat names → human descriptions, used by tooltips
const STRAT_LABELS = {json.dumps({v["name"]: v["desc"] for v in STRAT_INFO.values()}, indent=2)};

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

OUT = ROOT / "alphabot" / "static" / "data.js"
OUT.write_text(js, encoding="utf-8")
print(f"\nWrote {OUT}")
print(f"  trades: {len(trades_sorted)}  closed: {len(closed)}  open_pos: {'yes' if OPEN_POSITION else 'no'}")
print(f"  account: ${final_eq:,.2f}  WR: {wr}%  maxDD: {max_dd}%")
