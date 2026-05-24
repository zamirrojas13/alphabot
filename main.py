#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════
# AlphaBot v2 — main entry point
# Scans every 10 min, fires Telegram + records ledger on signals.
# Dry-run by default; flip config.DRY_RUN to go live.
# ═══════════════════════════════════════════════════════════════════
import argparse
import json
import sys
import schedule
import time
import traceback
from datetime import datetime, timezone

from signal_engine import config, state, ledger
from signal_engine.data_fetcher    import fetch_all
from signal_engine.indicators       import add_indicators
from signal_engine.strategy         import scan_all, likelihood, score_all_patterns
from signal_engine.coinbase_trader  import execute, get_account_equity
from signal_engine.trade_tracker    import start_tracker
from signal_engine.telegram_alerts  import (
    send_weekly_report,
    send_message, alert_trade_executed, alert_trade_closed,
    send_morning_brief, reply_status, reply_likelihood,
    reply_help, alert_startup, reply_pnl, reply_scan,
    reply_risk, reply_paused, reply_resumed, reply_close,
    alert_pattern_level_change,
)
from signal_engine import ledger


def _conviction_multiplier(sig: dict, st: dict, base: float) -> tuple[float, str | None]:
    """Return (final_multiplier, reason_str|None). Boosts T1 signals 1.5x under qualifying conditions."""
    if not config.CONVICTION_MULTIPLIER_ENABLED:
        return base, None
    if sig.get("tier") != 1:
        return base, None
    dd = st.get("portfolio_dd_pct", 0.0) or 0.0
    if dd <= config.DD_FILTER_PCT:        # -10%: DD filter active, never boost
        return base, None
    loss_streak = st.get("loss_streak", 0)
    clean = (loss_streak == 0 and dd > -5.0)
    last_win = config.CONVICTION_LAST_WIN_ENABLED and st.get("last_trade_result") == "win"
    if clean:
        return base * 1.5, "clean_slate"
    elif last_win:
        return base * 1.5, "last_win"
    return base, None


def _frames_with_indicators() -> dict:
    raw = fetch_all()
    return {tf: add_indicators(df.copy()) for tf, df in raw.items()}


def _next_scan_minutes() -> int:
    """Minutes until the next scheduled scan."""
    try:
        import schedule as sch
        job = next((j for j in sch.jobs if "run_scan" in str(j)), None)
        if job and job.next_run:
            delta = (job.next_run - datetime.now()).total_seconds()
            return max(1, int(delta / 60))
    except Exception:
        pass
    return config.RUN_INTERVAL_MINUTES


def _run_brain_scan(now):
    """AlphaBrain v4 scan — fully independent from AlphaBot. Never raises."""
    from pathlib import Path as _P
    from signal_engine.brain.level_manager import (
        load_levels, save_levels, check_arrival, get_active_levels,
    )
    from signal_engine.brain.brain_signals import scan_brain
    from signal_engine.data_fetcher import fetch_h1

    BRAIN_DIR = _P(__file__).parent           # btc-bot/ — where brain_levels.json lives

    df_1h = fetch_h1(n_bars=200)
    current_price = float(df_1h['close'].iloc[-1])

    levels = load_levels(BRAIN_DIR / 'brain_levels.json')
    if not levels:
        print("  [BRAIN] No levels -- brain_levels.json empty.")
        return

    arrived = check_arrival(levels, current_price, now)
    if arrived:
        print(f"  [BRAIN] Arrived: {arrived}")

    active  = get_active_levels(levels, current_price)
    signals = scan_brain(df_1h, active, prev_week_range=None, as_of=now)

    for sig in signals:
        print(f"  [BRAIN] Signal: {sig['strategy']} {sig['direction']} entry={sig['entry']}")
        _brain_execute(sig, levels, now)

    save_levels(levels, BRAIN_DIR / 'brain_levels.json')

    n_conf = sum(1 for l in levels if l['status'] == 'CONFIRMING')
    print(f"  [BRAIN] done. active={len(active)} confirming={n_conf} signals={len(signals)}")


def _brain_execute(sig, levels, now):
    """Log brain trade to brain_trades.csv, update brain_state.json, alert Telegram."""
    import json as _json, csv as _csv
    from pathlib import Path as _P
    from signal_engine.brain.brain_sizing import calculate_brain_size, get_macro_size_multiplier
    from signal_engine.brain.macro_context import get_macro_context

    BRAIN_DIR = _P(__file__).parent

    state_fp = BRAIN_DIR / 'brain_state.json'
    brain_st = _json.loads(state_fp.read_text()) if state_fp.exists() else {}

    if brain_st.get('active_trade'):
        print("  [BRAIN] Skipping -- active brain trade already open.")
        return

    brain_equity = float(brain_st.get('equity', 1000))

    try:
        from signal_engine.data_fetcher import fetch_daily
        import pandas as _pd
        df_d = fetch_daily(n_bars=300)
        df_d_idx = df_d.set_index(_pd.to_datetime(df_d['datetime'], utc=True)).drop(columns=['datetime'])
        df_w = df_d_idx.resample('W-MON', label='left', closed='left').agg(
            {'open':'first','high':'max','low':'min','close':'last','volume':'sum'}).dropna().reset_index()
        df_m = df_d_idx.resample('MS').agg(
            {'open':'first','high':'max','low':'min','close':'last','volume':'sum'}).dropna().reset_index()
        macro = get_macro_context(df_d, df_w, df_m)
    except Exception:
        macro = {}

    macro_mult    = get_macro_size_multiplier(sig['direction'], macro)
    macro_aligned = (macro_mult == 1.0)
    is_weekend    = now.weekday() >= 5

    contracts, _ = calculate_brain_size(
        sig['entry'], sig['sl'], sig['entry'], brain_equity,
        level_strength=sig.get('level_strength', 'LOW'),
        macro_aligned=macro_aligned,
        is_weekend=is_weekend,
        macro_size_mult=macro_mult,
    )
    if contracts == 0:
        print("  [BRAIN] 0 contracts sized -- signal skipped.")
        return

    trade_id = f"BRN-{now.strftime('%Y%m%d-%H%M')}"
    trade = {
        'trade_id':        trade_id,
        'timestamp_entry': now.isoformat(),
        'direction':       sig['direction'],
        'level_id':        sig['level_id'],
        'level_type':      sig['level_type'],
        'level_price':     sig['level_price'],
        'level_strength':  sig['level_strength'],
        'entry':           sig['entry'],
        'sl':              sig['sl'],
        'goal_1':          sig['goal_1'],
        'goal_2':          sig['goal_2'],
        'goal_3':          sig['goal_3'],
        'contracts':       contracts,
        'macro_mult':      macro_mult,
        'exit_price':      '',
        'exit_reason':     '',
        'r_multiple':      '',
        'pnl_usd':         '',
        'timestamp_exit':  '',
    }

    trades_fp = BRAIN_DIR / 'brain_trades.csv'
    write_hdr = not trades_fp.exists()
    with open(trades_fp, 'a', newline='') as _f:
        w = _csv.DictWriter(_f, fieldnames=list(trade.keys()))
        if write_hdr:
            w.writeheader()
        w.writerow(trade)

    for lvl in levels:
        if lvl['id'] == sig['level_id']:
            lvl['trade_id'] = trade_id

    brain_st['active_trade'] = trade
    brain_st['trade_count']  = brain_st.get('trade_count', 0) + 1
    state_fp.write_text(_json.dumps(brain_st, indent=2))

    dir_emoji = '\U0001f4c8' if sig['direction'] == 'LONG' else '\U0001f4c9'
    macro_lbl = 'aligned' if macro_mult == 1.0 else ('neutral' if macro_mult == 0.85 else 'counter-trend')
    msg = (
        f"{dir_emoji} *AlphaBrain Signal*\n\n"
        f"Level: `{sig['level_id']}` ({sig['level_type'].replace('_', ' ')})\n"
        f"Direction: *{sig['direction']}* | Strength: {sig.get('level_strength', '?')}\n"
        f"Entry: `${sig['entry']:,.0f}` | SL: `${sig['sl']:,.0f}`\n"
        f"G1: `${sig['goal_1']:,.0f}` | G2: `${sig['goal_2']:,.0f}` | G3: `${sig['goal_3']:,.0f}`\n"
        f"Contracts: `{contracts}` | Macro: {macro_lbl} ({macro_mult}x)\n"
        f"_Paper mode_"
    )
    try:
        send_message(msg)
    except Exception as _e:
        print(f"  [BRAIN] Telegram alert failed: {_e}")

    print(f"  [BRAIN] Trade logged: {trade_id} {sig['direction']} {contracts}ct")


def run_scan() -> None:
    now = datetime.now(timezone.utc)
    now_str = now.strftime("%H:%M UTC")
    print(f"\n{'='*60}\n  Scan @ {now.strftime('%Y-%m-%d %H:%M UTC')}\n{'='*60}")
    try:
        frames = _frames_with_indicators()
        signals = scan_all(frames)
        new_levels = score_all_patterns(frames)
        st = state.get()
        st["last_scan_time"] = now_str
        old_levels = st.get("pattern_levels", {})

        # Fire one alert per strategy that changed strength level
        for sid, new_lvl in new_levels.items():
            old_lvl = old_levels.get(sid, 0)
            if new_lvl != old_lvl:
                try:
                    alert_pattern_level_change(sid, old_lvl, new_lvl, frames)
                except Exception as ae:
                    print(f"  [escalation] {sid}: {ae}")

        st["pattern_levels"] = new_levels
        st["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
        state.save(st)
        print(f"  Signals fired: {len(signals)}")
    except Exception as e:
        print(f"  [ERROR] scan failed: {e}")
        traceback.print_exc()
        return

    # ── AlphaBrain scan (isolated — never affects AlphaBot) ─────────────────
    try:
        _run_brain_scan(now)
    except Exception as _be:
        print(f"  [BRAIN] scan error: {_be}")

    if not signals:
        return

    equity = get_account_equity()
    st = state.get()

    # User manually paused the bot — skip all new entries
    if st.get("bot_paused"):
        print("  [PAUSED] Bot is paused — no new trades.")
        return

    # Circuit breaker #1: full DD stop
    port_dd = st.get("portfolio_dd_pct", 0.0) or 0.0
    if port_dd <= config.DD_CIRCUIT_BREAKER:
        if not st.get("circuit_breaker_alerted"):
            send_message("Circuit Breaker: DD " + str(round(port_dd,1)) + "% hit limit " + str(config.DD_CIRCUIT_BREAKER) + "%. All trading paused. /resume to restart.")
            st["bot_paused"] = True
            st["circuit_breaker_alerted"] = True
            state.save(st)
        print("  [CIRCUIT BREAKER] DD " + str(port_dd) + "% paused.")
        return
    else:
        st["circuit_breaker_alerted"] = False

    # Circuit breaker #2: loss streak sizing reduction
    loss_streak = st.get("loss_streak", 0)
    size_multiplier = 1.0
    if loss_streak >= config.LOSS_STREAK_PAUSE:
        send_message("Loss streak: " + str(loss_streak) + " losses. Trading paused. /resume to restart.")
        st["bot_paused"] = True
        state.save(st)
        print("  [LOSS STREAK] " + str(loss_streak) + " losses — pausing.")
        return
    elif loss_streak >= config.LOSS_STREAK_HALF_SIZE:
        size_multiplier = 0.5
        print(f"  [LOSS STREAK] {loss_streak} losses — half size mode.")

    for sig in signals:
        # DD filter: tier-3 paused if portfolio in deep DD
        if st.get("tier3_paused") and sig["tier"] == 3:
            print(f"  Skipping {sig['name']}: T3 paused (DD {st.get('portfolio_dd_pct'):.1f}%).")
            continue
        # Concurrent trade guard: only one open at a time for now
        if st.get("active_trade"):
            print(f"  Skipping {sig['name']}: active trade exists.")
            continue
        # Bar de-dupe
        bar_key = f"{sig['strat_id']}_{sig['tf']}_{frames[sig['tf']].iloc[-1]['datetime']}"
        if state.already_alerted_bar(bar_key):
            print(f"  Skipping {sig['name']}: already alerted for this bar.")
            continue

        # Conviction multiplier — T1 signals get 1.5x under qualifying conditions
        final_multiplier, cm_reason = _conviction_multiplier(sig, st, size_multiplier)
        if cm_reason:
            print(f"  [CM] {sig['name']}: 1.5x boost ({cm_reason})")

        # Execute (or simulate)
        trade = execute(sig, equity, size_multiplier=final_multiplier)
        if not trade.get("executed"):
            print(f"  {sig['name']} not executed: {trade.get('skip_reason')}")
            continue

        # Persist
        ledger.append(trade)
        state.set_active_trade(trade)
        state.mark_alerted(bar_key)

        # Notify
        alert_trade_executed(trade, equity, dry_run=config.DRY_RUN)
        print(f"  ✓ Alerted: {trade['name']}  ({trade['order_id']})")


def send_heartbeat() -> None:
    """Every 6 h: confirm bot is alive with last scan time and trade status."""
    try:
        st    = state.get()
        active = st.get("active_trade")
        last   = st.get("last_scan_time", "—")
        mode   = "DRY-RUN 🟡" if config.DRY_RUN else "LIVE 🟢"
        if active:
            trade_line = (
                f"📊 Open trade: *{active.get('name', active.get('strat_id', '—'))}* "
                f"{active['side'].upper()} · entry ${active['entry']:,.2f}"
            )
        else:
            trade_line = "⏸ No open trade"
        msg = (
            f"🤖 *Bot alive* — {mode}\n\n"
            f"Last scan: {last}\n"
            f"{trade_line}\n\n"
            f"_Send /status for full details_"
        )
        send_message(msg)
    except Exception as e:
        print(f"[Heartbeat] {e}")


def run_morning_brief() -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.already_briefed_today(today):
        print("[Brief] already sent today — skip.")
        return
    try:
        frames  = _frames_with_indicators()
        equity  = get_account_equity()
        st      = state.get()
        signals = scan_all(frames)
        ok = send_morning_brief(
            st, equity, frames,
            signals_today=len(signals),
            next_scan_min=_next_scan_minutes(),
        )
        if ok:
            state.mark_briefed(today)
            print(f"[Brief] sent for {today}")
    except Exception as e:
        print(f"[Brief] error: {e}")
        traceback.print_exc()


# ── Listener: handles /status and /trade long|short ──────────────
def _handle_command(text: str) -> str | None:
    """Returns reply text, or None if command not recognized."""
    cmd = text.strip().lower()

    if cmd in ("/status", "status"):
        frames = _frames_with_indicators()
        return reply_status(state.get(), get_account_equity(),
                            frames=frames, next_scan_min=_next_scan_minutes())

    if cmd in ("/pnl", "pnl"):
        equity = get_account_equity()
        return reply_pnl(ledger.read_all(), equity)

    if cmd in ("/scan", "scan"):
        frames  = _frames_with_indicators()
        signals = scan_all(frames)
        st = state.get(); st["last_scan_time"] = datetime.now(timezone.utc).strftime("%H:%M UTC"); state.save(st)
        return reply_scan(signals, frames)

    if cmd in ("/risk", "risk"):
        return reply_risk(state.get().get("active_trade"), get_account_equity())

    if cmd in ("/pause", "pause"):
        st = state.get(); st["bot_paused"] = True; state.save(st)
        return reply_paused()

    if cmd in ("/resume", "resume"):
        st = state.get(); st["bot_paused"] = False; state.save(st)
        return reply_resumed()

    if cmd in ("/trade long", "trade long"):
        frames = _frames_with_indicators()
        return reply_likelihood("long", likelihood("long", frames))

    if cmd in ("/trade short", "trade short"):
        frames = _frames_with_indicators()
        return reply_likelihood("short", likelihood("short", frames))

    if cmd in ("/close", "close"):
        from signal_engine.trade_tracker import _ticker_price, _close_trade
        st = state.get()
        active = st.get("active_trade")
        if not active:
            return "No active trade to close."
        price = _ticker_price()
        if price is None:
            return "⚠️ Could not fetch current price — try again in a moment."
        exit_data = _close_trade(active, price, "manual_close")
        state.update_last_trade_result(exit_data["pnl_net_usd"] > 0)
        state.set_active_trade(None)
        return reply_close(active, exit_data)

    if cmd in ("/help", "help"):
        return reply_help()

    return None


def start_listener_loop():
    """Polls Telegram getUpdates for commands. Lightweight, no external lib."""
    import requests, threading
    last_update_id = 0

    def loop():
        nonlocal last_update_id
        url = f"https://api.telegram.org/bot{config.TELEGRAM_TOKEN}/getUpdates"
        while True:
            try:
                r = requests.get(url, params={"offset": last_update_id+1, "timeout": 25}, timeout=30)
                if r.status_code != 200:
                    time.sleep(5); continue
                for upd in r.json().get("result", []):
                    last_update_id = upd["update_id"]
                    msg = upd.get("message", {})
                    text = msg.get("text", "")
                    chat_id = msg.get("chat", {}).get("id")
                    if str(chat_id) != str(config.TELEGRAM_CHAT_ID):
                        continue
                    reply = _handle_command(text)
                    if reply:
                        send_message(reply)
            except Exception as e:
                print(f"[Listener] {e}")
                time.sleep(10)

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return t


def run_daily_selftest() -> None:
    """Layer 7 — 09:50 UTC daily: verify all systems before morning brief."""
    import shutil as _shutil
    results = []
    ok = True

    # 1. Ledger validation
    valid, msg = ledger.validate_ledger()
    results.append(("Ledger", valid, msg))
    if not valid:
        ok = False

    # 2. Telegram (we're sending this, so it works)
    results.append(("Telegram", True, "OK"))

    # 3. Disk space
    usage = _shutil.disk_usage("/")
    free_mb = usage.free // (1024 * 1024)
    disk_ok = free_mb > 500
    results.append(("Disk", disk_ok, f"{free_mb}MB free"))
    if not disk_ok:
        ok = False

    # 4. State file
    try:
        st = state.get()
        results.append(("State", True, "OK"))
    except Exception as e:
        results.append(("State", False, str(e)))
        ok = False

    if ok:
        send_message("✅ *Daily self-test passed*\n" + "\n".join(f"  ✓ {n}: {m}" for n, _, m in results))
    else:
        lines = "\n".join(f"  {'✓' if s else '✗'} {n}: {m}" for n, s, m in results)
        send_message(f"⚠️ *Daily self-test FAILED*\n\n{lines}\n\n_Trading continues but check needed._")


def _startup_self_test() -> None:
    """Print startup health summary visible in journalctl."""
    import urllib.request as _ur
    from datetime import timedelta

    checks = []

    # 1. Dashboard /health endpoint
    try:
        resp = _ur.urlopen("http://localhost:8765/health", timeout=3)
        data = json.loads(resp.read())
        checks.append(("Dashboard", True, f"OK (uptime {data.get('uptime_seconds','?')}s)"))
    except Exception as e:
        checks.append(("Dashboard", False, str(e)[:80]))

    # 2. State file
    try:
        state.get()
        checks.append(("State", True, "OK"))
    except Exception as e:
        checks.append(("State", False, str(e)[:80]))

    # 3. Coinbase API
    try:
        resp = _ur.urlopen("https://api.exchange.coinbase.com/products/BTC-USD/ticker", timeout=5)
        checks.append(("Coinbase", resp.status == 200, "OK" if resp.status == 200 else f"HTTP {resp.status}"))
    except Exception as e:
        checks.append(("Coinbase", False, str(e)[:80]))

    # 4. Telegram token
    tg_ok = bool(config.TELEGRAM_TOKEN) and "YOUR_BOT" not in config.TELEGRAM_TOKEN
    checks.append(("Telegram", tg_ok, "OK" if tg_ok else "token not configured"))

    # Next scan time
    now = datetime.now(timezone.utc)
    mins_until = config.RUN_INTERVAL_MINUTES - (now.minute % config.RUN_INTERVAL_MINUTES)
    next_scan = (now + timedelta(minutes=mins_until)).strftime("%H:%M")

    version = getattr(config, "BOT_VERSION", "2.4.x")
    print(f"=== AlphaBot {version} started ===")
    for name, ok, msg in checks:
        sym = "✓" if ok else "✗"
        suffix = "OK" if ok else f"FAILED — {msg}"
        print(f"  {sym} {name}: {suffix}")
    print(f"  Next scan: {next_scan} UTC")


def _startup_position_check() -> None:
    """Layer 4 — check position state on startup."""
    from datetime import timezone as _tz
    st = state.get()
    active = st.get("active_trade")
    if active is not None and not active.get("executed"):
        print("[Startup] Found unexecuted active_trade — clearing from state.")
        try:
            send_message("🟡 *Startup warning* — found unexecuted trade in state, clearing it.")
        except Exception:
            pass
        st["active_trade"] = None
    # Write startup heartbeat
    st["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
    state.save(st)
    print(f"[Startup] Position check done. active_trade={'yes' if active and active.get('executed') else 'none'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--brief", action="store_true", help="Send morning brief and exit")
    parser.add_argument("--once",  action="store_true", help="Run scan once and exit")
    args = parser.parse_args()

    if args.brief:
        run_morning_brief()
        return
    if args.once:
        run_scan()
        return

    import os as _os
    from pathlib import Path as _Path
    _BOT_DIR = _Path("/home/ubuntu/btc-bot")
    (_BOT_DIR / "bot.pid").write_text(str(_os.getpid()))
    _startup_self_test()

    tg_ok = bool(config.TELEGRAM_TOKEN) and "YOUR_BOT" not in config.TELEGRAM_TOKEN
    if tg_ok:
        alert_startup(dry_run=config.DRY_RUN)
        start_listener_loop()
    start_tracker()
    _startup_position_check()

    schedule.every().day.at(config.MORNING_BRIEF_LOCAL).do(run_morning_brief)
    schedule.every().day.at("09:50").do(run_daily_selftest)
    schedule.every(6).hours.do(send_heartbeat)
    schedule.every().sunday.at("09:00").do(lambda: send_weekly_report(
        ledger.read_all(), get_account_equity(), config.ACCOUNT_SIZE))
    run_scan()
    schedule.every(config.RUN_INTERVAL_MINUTES).minutes.do(run_scan)

    # Write strategy registry to file so dashboard can read it
    import json
    from signal_engine.state import get_strategy_registry
    reg_path = config.STATE_FILE.parent / 'strategy_registry.json'
    reg_path.write_text(json.dumps(get_strategy_registry(), indent=2))

    # Layer 2 — circuit breaker state
    _loop_errors: list = []          # (timestamp, error_type_str)
    _tg_last_sent: dict = {}         # error_type -> last_sent_timestamp

    while True:
        try:
            schedule.run_pending()
            # Successful iteration: reset error list
            _loop_errors.clear()
        except Exception as e:
            err_type = type(e).__name__
            now_ts = time.time()

            # Dedup: max 1 Telegram alert per error_type per 10 min
            last_sent = _tg_last_sent.get(err_type, 0)
            if now_ts - last_sent > 600:
                _tg_last_sent[err_type] = now_ts
                try:
                    send_message(f"⚠️ *Bot loop error* — {e}\n_Attempting to continue..._")
                except Exception:
                    pass

            print(f"[Main loop] {err_type}: {e}")
            traceback.print_exc()

            # Track errors within a rolling 5-min window
            _loop_errors.append((now_ts, err_type))
            _loop_errors[:] = [(t, et) for t, et in _loop_errors if now_ts - t < 300]

            # Count same error type
            same_type_count = sum(1 for _, et in _loop_errors if et == err_type)
            if same_type_count >= 3:
                try:
                    send_message(
                        f"🔴 CIRCUIT BREAKER — `{err_type}` fired {same_type_count}x "
                        f"in 5 min. Bot shutting down for safety.\n"
                        f"Run `sudo systemctl start alphabot` to restart."
                    )
                except Exception:
                    pass
                sys.exit(1)

        time.sleep(20)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as _fatal:
        traceback.print_exc()
        try:
            send_message(
                f"💀 *Bot crashed* — fatal error\n\n`{type(_fatal).__name__}: {_fatal}`\n\n"
                "_Restart main.py to resume trading._"
            )
        except Exception:
            pass
        raise
