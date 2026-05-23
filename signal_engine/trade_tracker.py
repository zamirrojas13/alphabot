# ═══════════════════════════════════════════════════════════════════
# Trade tracker — closes active trades when TP, SL, or horizon hits.
# Runs every minute; reads state.json, fetches live Coinbase ticker,
# compares vs the active trade's targets, closes + logs + alerts.
# ═══════════════════════════════════════════════════════════════════
import time
import threading
import requests
from datetime import datetime, timezone
from . import config, state, ledger
from .telegram_alerts import send_message


# Fee model — Coinbase CFM nano-futures, MAKER tier (limit orders) = 0.05% per side
# (Taker is 0.10-0.11%; we use limit orders so we pay maker.)
FEE_PER_SIDE = 0.00075  # 0.075% taker (Coinbase CFM taker 0.10% + NFA fees)
SLIPPAGE_PER_SIDE = 0.0005  # 0.05% slippage per side on market fills


# Cache front-month BIT futures symbol; refresh hourly
_fm_cache: tuple[str, object] | None = None

def _get_front_month() -> str | None:
    """Return nearest non-expired BIT-*-CDE product_id; cached 1 hour."""
    global _fm_cache
    from datetime import timezone as _tz
    now = datetime.now(_tz.utc)
    if _fm_cache:
        sym, fetched = _fm_cache
        if (now - fetched).total_seconds() < 3600:
            return sym
    try:
        r = requests.get(
            f"{config.FUTURES_REST_BASE}/products",
            params={"product_type": "FUTURE"},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        candidates = []
        for p in r.json().get("products", []):
            pid = p.get("product_id", "")
            if not (pid.startswith("BIT-") and pid.endswith("-CDE")):
                continue
            details = p.get("future_product_details") or {}
            exp_str = details.get("contract_expiry", "")
            if not exp_str:
                continue
            try:
                from datetime import timezone as _tz2
                exp = datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
                if exp > now:
                    candidates.append((exp, pid))
            except Exception:
                continue
        if not candidates:
            return None
        candidates.sort()
        sym = candidates[0][1]
        _fm_cache = (sym, now)
        return sym
    except Exception:
        return None


def _ticker_price() -> float | None:
    """Live BTC price: CFM front-month nano futures (BIT-*-CDE), fallback spot."""
    sym = _get_front_month()
    if sym:
        try:
            r = requests.get(
                f"{config.FUTURES_REST_BASE}/products/{sym}",
                timeout=8,
            )
            if r.status_code == 200:
                price = float(r.json().get("price", 0) or 0)
                if price > 0:
                    return price
        except Exception:
            pass
    # fallback: BTC-USD spot
    try:
        r = requests.get(
            f"{config.COINBASE_REST_BASE}/products/{config.SYMBOL}/ticker",
            timeout=8,
        )
        if r.status_code != 200:
            return None
        return float(r.json().get("price", 0.0)) or None
    except Exception:
        return None


def _bars_held(entry_iso: str, tf: str) -> int:
    """Approximate bars held for the trade's TF since entry."""
    try:
        ts = datetime.fromisoformat(entry_iso.replace("Z", "+00:00"))
    except Exception:
        return 0
    elapsed_sec = (datetime.now(timezone.utc) - ts).total_seconds()
    bar_seconds = {"1w": 7*86400, "1d": 86400, "4h": 14400, "1h": 3600}.get(tf, 3600)
    return int(elapsed_sec // bar_seconds)


def _hit_check(active: dict, price: float) -> tuple[str | None, float]:
    """Returns (exit_reason, exit_price) if TP/SL hit, else (None, price)."""
    side = active["side"]
    tp = active["tp"]; sl = active["sl"]
    if side == "long":
        if price >= tp: return ("tp_hit", tp)
        if price <= sl: return ("sl_hit", sl)
    else:
        if price <= tp: return ("tp_hit", tp)
        if price >= sl: return ("sl_hit", sl)
    return (None, price)


def _breakeven_check(active: dict, price: float) -> bool:
    """Phase 1 of trade management (Alex's step 4):
    When price reaches 0.85R profit, lock the stop to entry (breakeven).
    Fires only once — sets active['be_set'] = True and updates active['sl'].
    Returns True if SL was just moved to breakeven this tick.
    """
    if active.get("be_set"):
        return False                  # already done
    side   = active["side"]
    entry  = active["entry"]
    sl_pct = active.get("sl_pct", 0.05) or 0.05
    thresh = entry * sl_pct * 1.0  # 1R = confirmed profit before locking BE   # 85% of 1R = trigger for BE

    moved = False
    if side == "long"  and price >= entry + thresh:
        active["sl"]     = entry      # SL → breakeven
        active["be_set"] = True
        moved = True
    elif side == "short" and price <= entry - thresh:
        active["sl"]     = entry      # SL → breakeven
        active["be_set"] = True
        moved = True

    if moved:
        print(f"[Tracker] breakeven locked at ${entry:,.2f}")
    return moved


def _trail_check(active: dict, price: float) -> tuple[str | None, float]:
    """Phase 2 of trade management (Alex's step 4):
    Once price is 1R in profit, trail the stop at sl_pct distance behind
    the best price reached.  Breakeven (_breakeven_check) fires first at 0.85R.
    Updates active dict in-place (trail_high / trail_low).
    Returns (exit_reason, exit_price) or (None, price).
    """
    side    = active["side"]
    entry   = active["entry"]
    sl_pct  = active.get("sl_pct", 0.05) or 0.05
    sl_dist = entry * sl_pct          # 1R = move of sl_dist in profit dir

    # Tighten trail to 50% SL dist once 1.5R is reached (#5)
    profit_r = abs(price - entry) / sl_dist if sl_dist else 0
    trail_dist = sl_dist * (0.5 if profit_r >= 1.5 else 1.0)

    if side == "long":
        if price < entry + sl_dist:
            return (None, price)
        peak = max(active.get("trail_high", 0.0), price)
        active["trail_high"] = peak
        trail_stop = peak - trail_dist
        if price <= trail_stop:
            return ("trail_stop", round(trail_stop, 2))

    else:  # short
        if price > entry - sl_dist:
            return (None, price)
        trough = min(active.get("trail_low", float("inf")), price)
        active["trail_low"] = trough
        trail_stop = trough + trail_dist
        if price >= trail_stop:
            return ("trail_stop", round(trail_stop, 2))

    return (None, price)


def _horizon_check(active: dict) -> bool:
    """Returns True if max horizon bars reached."""
    info = config.STRATEGIES.get(active.get("strat_id"))
    if not info: return False
    bars = _bars_held(active["timestamp_entry"], info["tf"])
    return bars >= info["horizon"]


def _close_trade(active: dict, exit_price: float, exit_reason: str) -> dict:
    """Compute PnL and update ledger + state."""
    qty = active.get("qty_btc", 0)
    entry = active["entry"]
    side = active["side"]
    if side == "long":
        gross_pct = (exit_price - entry) / entry
    else:
        gross_pct = (entry - exit_price) / entry
    pnl_usd = qty * entry * gross_pct
    fees_usd = qty * entry * 2 * (FEE_PER_SIDE + SLIPPAGE_PER_SIDE)
    sl_pct = active.get("sl_pct", 0.05) or 0.05
    r_mult = gross_pct / sl_pct if sl_pct else 0
    # Partial exit at 1R: 50% was already closed — add that PnL + blend R
    if active.get("partial_done"):
        pq = active.get("partial_qty_btc", 0)
        pp = active.get("partial_price", entry)
        partial_gross = (pp - entry) if side == "long" else (entry - pp)
        pnl_usd   += pq * partial_gross
        fees_usd  += pq * entry * (FEE_PER_SIDE + SLIPPAGE_PER_SIDE)  # exit fee for partial
        partial_r  = (partial_gross / entry) / sl_pct if sl_pct else 0
        r_mult     = 0.5 * partial_r + 0.5 * r_mult   # blended R
    pnl_net = pnl_usd - fees_usd
    info = config.STRATEGIES.get(active.get("strat_id"), {})
    bars = _bars_held(active["timestamp_entry"], info.get("tf", "1d"))

    exit_data = {
        "exit_price":   round(exit_price, 2),
        "exit_reason":  exit_reason,
        "bars_held":    bars,
        "pnl_usd":      round(pnl_usd, 2),
        "pnl_pct":      round(gross_pct * 100, 2),
        "r_multiple":   round(r_mult, 2),
        "fees_usd":     round(fees_usd, 2),
        "pnl_net_usd":  round(pnl_net, 2),
        "timestamp_exit": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    ledger.update_exit(active["order_id"], exit_data)
    return exit_data


def _alert_close(active: dict, exit_data: dict) -> None:
    pnl = exit_data["pnl_net_usd"]
    win = pnl > 0
    emoji = "✅" if win else "❌"
    reason_human = {"tp_hit": "Target hit", "sl_hit": "Stop hit",
                     "time_exit": "Time exit", "trail_stop": "Trail stop",
                     "manual_close": "Manual close"}.get(exit_data["exit_reason"], exit_data["exit_reason"])
    msg = f"""{emoji} *Trade Closed* — {reason_human}

*Setup:* {active['name']}
*Direction:* {active['side'].upper()}

`Entry:` ${active['entry']:,.2f}
`Exit:`  ${exit_data['exit_price']:,.2f}
`Bars held:` {exit_data['bars_held']}

*PnL:* ${pnl:+.2f}  ({exit_data['pnl_pct']:+.2f}%, {exit_data['r_multiple']:+.2f}R)
*Fees:* ${exit_data['fees_usd']:.2f}
"""
    send_message(msg)


def _check_once():
    st = state.get()
    active = st.get("active_trade")
    if not active:
        return
    price = _ticker_price()
    if price is None:
        return

    reason, ex_price = _hit_check(active, price)
    if reason is None:
        # Phase 1: lock to breakeven at 0.85R (Alex's step 4)
        be_just_set = _breakeven_check(active, price)
        if be_just_set and not active.get("partial_done"):
            # Partial exit at 1R: close 50%, let other 50% run to TP (matches backtest)
            full_qty  = active.get("qty_btc", 0)
            part_qty  = round(full_qty * 0.5, 6)
            active["partial_done"]    = True
            active["partial_qty_btc"] = part_qty
            active["partial_price"]   = round(price, 2)
            active["qty_btc"]         = round(full_qty - part_qty, 6)
            active["nano_qty"]        = max(1, (active.get("nano_qty", 0) + 1) // 2)
            sl_p = active.get("sl_pct", 0.05) or 0.05
            partial_usd = part_qty * active["entry"] * sl_p  # ~1R gain on 50%
            send_message(
                f"🎯 *Partial Exit (50%)* — {active.get('name', active.get('strat_id',''))}\n\n"
                f"Closed 50% at *${price:,.2f}* (+1R)\n"
                f"Locked PnL: *+${partial_usd:.2f}* on {part_qty:.4f} BTC\n\n"
                f"Remaining 50% runs to TP  ·  SL now at breakeven"
            )
        elif be_just_set:
            send_message(
                f"🔒 *Breakeven locked* — {active.get('name', active.get('strat_id',''))}\n"
                f"Stop moved to entry ${active['entry']:,.2f}  ·  trade now risk-free"
            )

        # Phase 1.5: alert at 1.5R
        sl_pct = active.get("sl_pct", 0.05) or 0.05
        entry  = active["entry"]
        sl_dist = entry * sl_pct
        side    = active["side"]
        at_1_5r = (side == "long"  and price >= entry + sl_dist * 1.5) or \
                  (side == "short" and price <= entry - sl_dist * 1.5)
        if at_1_5r and not active.get("alert_1_5r"):
            active["alert_1_5r"] = True
            qty   = active.get("qty_btc", 0)
            unr   = (price - entry) * qty if side == "long" else (entry - price) * qty
            send_message(
                f"📈 *+1.5R reached* — {active.get('name', active.get('strat_id',''))}\n\n"
                f"Unrealized: *${unr:+.2f}*  ·  Price ${price:,.2f}\n"
                f"_Trail stop active — remainder runs to full TP._"
            )

        # Phase 2: trail at 1R
        reason, ex_price = _trail_check(active, price)
    if reason is None and _horizon_check(active):
        reason, ex_price = ("time_exit", price)
    if reason is None:
        # Update unrealized info so /status shows fresh data
        active["current_price"] = round(price, 2)
        side = active["side"]
        qty = active.get("qty_btc", 0)
        unr = (price - active["entry"]) * qty if side == "long" else (active["entry"] - price) * qty
        active["unrealized_pl"] = round(unr, 2)
        active["bars_held"] = _bars_held(active["timestamp_entry"],
                                          config.STRATEGIES.get(active.get("strat_id"), {}).get("tf", "1d"))
        st["active_trade"] = active
        state.save(st)
        return

    # Close
    exit_data = _close_trade(active, ex_price, reason)
    _alert_close(active, exit_data)
    state.update_last_trade_result(exit_data["pnl_net_usd"] > 0)
    state.set_active_trade(None)
    print(f"[Tracker] closed {active['name']} via {reason} pnl ${exit_data['pnl_net_usd']:+.2f}")


def start_tracker(interval_sec: int = 60):
    """Background thread: poll price every minute, close trades that hit targets."""
    def loop():
        while True:
            try:
                _check_once()
            except Exception as e:
                print(f"[Tracker] {e}")
            time.sleep(interval_sec)

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    print(f"[Tracker] running every {interval_sec}s")
    return t
