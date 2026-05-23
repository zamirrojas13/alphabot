#!/usr/bin/env python3
"""Patch main.py — Layers 2, 4, 7: circuit breaker, startup check, daily selftest, PID file, heartbeat in run_scan."""

MAIN_PATH = "/home/ubuntu/btc-bot/main.py"

with open(MAIN_PATH, "r", encoding="utf-8") as f:
    src = f.read()

# ── 1. Add missing imports ───────────────────────────────────────
# Add sys import if not present
if "import sys\n" not in src:
    src = src.replace("import argparse\n", "import argparse\nimport sys\n", 1)

# ── 2. Replace the while True loop (Layer 2 — circuit breaker) ───
OLD_LOOP = """    while True:
        try:
            schedule.run_pending()
        except Exception as e:
            err_msg = f"⚠️ *Bot loop error* — {e}\\n_Attempting to continue..._"
            print(f"[Main loop] {e}")
            traceback.print_exc()
            try:
                send_message(err_msg)
            except Exception:
                pass
        time.sleep(20)"""

NEW_LOOP = """    # Layer 2 — circuit breaker state
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
                    send_message(f"⚠️ *Bot loop error* — {e}\\n_Attempting to continue..._")
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
                        f"in 5 min. Bot shutting down for safety.\\n"
                        f"Run `sudo systemctl start alphabot` to restart."
                    )
                except Exception:
                    pass
                sys.exit(1)

        time.sleep(20)"""

if OLD_LOOP in src:
    src = src.replace(OLD_LOOP, NEW_LOOP)
    print("Loop circuit breaker patched OK")
else:
    print("WARNING: could not find old loop — manual patch needed")

# ── 3. Add _startup_position_check() before main() ───────────────
STARTUP_CHECK_FN = '''
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

'''

# Insert before def main():
src = src.replace("\ndef main():\n", STARTUP_CHECK_FN + "\ndef main():\n", 1)
print("_startup_position_check() added OK")

# ── 4. Call _startup_position_check() inside main() before while True ───
# Insert after start_tracker() call
OLD_TRACKER_CALL = "    start_tracker()\n\n    schedule.every().day.at"
NEW_TRACKER_CALL = "    start_tracker()\n    _startup_position_check()\n\n    schedule.every().day.at"
if OLD_TRACKER_CALL in src:
    src = src.replace(OLD_TRACKER_CALL, NEW_TRACKER_CALL, 1)
    print("_startup_position_check() call inserted OK")
else:
    print("WARNING: could not insert _startup_position_check() call — check main() manually")

# ── 5. Write PID file in main() ──────────────────────────────────
OLD_PRINT_ALPHABOT = '    print(f"AlphaBot v2 — {\'DRY-RUN\' if config.DRY_RUN else \'LIVE\'} mode")'
NEW_PRINT_ALPHABOT = (
    '    import os as _os\n'
    '    from pathlib import Path as _Path\n'
    '    _BOT_DIR = _Path("/home/ubuntu/btc-bot")\n'
    '    (_BOT_DIR / "bot.pid").write_text(str(_os.getpid()))\n'
    '    print(f"AlphaBot v2 — {\'DRY-RUN\' if config.DRY_RUN else \'LIVE\'} mode")'
)
if OLD_PRINT_ALPHABOT in src:
    src = src.replace(OLD_PRINT_ALPHABOT, NEW_PRINT_ALPHABOT, 1)
    print("PID file write inserted OK")
else:
    print("WARNING: could not insert PID file write")

# ── 6. Add run_daily_selftest() and schedule it ──────────────────
SELFTEST_FN = '''
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

    # 2. Telegram (we\'re sending this, so it works)
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
        send_message("✅ *Daily self-test passed*\\n" + "\\n".join(f"  ✓ {n}: {m}" for n, _, m in results))
    else:
        lines = "\\n".join(f"  {\'✓\' if s else \'✗\'} {n}: {m}" for n, s, m in results)
        send_message(f"⚠️ *Daily self-test FAILED*\\n\\n{lines}\\n\\n_Trading continues but check needed._")

'''

# Insert before _startup_position_check
src = src.replace("\ndef _startup_position_check", SELFTEST_FN + "\ndef _startup_position_check", 1)
print("run_daily_selftest() added OK")

# ── 7. Schedule selftest at 09:50 UTC ────────────────────────────
OLD_SCHED = "    schedule.every().day.at(config.MORNING_BRIEF_LOCAL).do(run_morning_brief)"
NEW_SCHED = (
    "    schedule.every().day.at(config.MORNING_BRIEF_LOCAL).do(run_morning_brief)\n"
    "    schedule.every().day.at(\"09:50\").do(run_daily_selftest)"
)
if OLD_SCHED in src:
    src = src.replace(OLD_SCHED, NEW_SCHED, 1)
    print("Daily selftest scheduled OK")
else:
    print("WARNING: could not find schedule line for morning brief")

# ── 8. Add heartbeat write at end of run_scan() ─────────────────
# After the successful scan saves pattern_levels, write heartbeat
OLD_STATE_SAVE = "        state.save(st)\n        print(f\"  Signals fired: {len(signals)}\")"
NEW_STATE_SAVE = (
    "        st[\"last_heartbeat\"] = datetime.now(timezone.utc).isoformat()\n"
    "        state.save(st)\n"
    "        print(f\"  Signals fired: {len(signals)}\")"
)
if OLD_STATE_SAVE in src:
    src = src.replace(OLD_STATE_SAVE, NEW_STATE_SAVE, 1)
    print("Heartbeat write in run_scan() added OK")
else:
    print("WARNING: could not find run_scan state.save — heartbeat not added to run_scan")

with open(MAIN_PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("main.py patched OK")
