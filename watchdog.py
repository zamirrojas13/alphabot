#!/usr/bin/env python3
"""AlphaBot watchdog — runs every 5 min via cron."""
import json, os, sys, time, subprocess
from pathlib import Path
from datetime import datetime, timezone

BOT_DIR      = Path("/home/ubuntu/btc-bot")
PID_FILE     = BOT_DIR / "bot.pid"
STATE_FILE   = BOT_DIR / "state.json"
LEDGER_FILE  = Path("/home/ubuntu/btc-data/trades_ledger_v2.csv")
RESTART_LOG  = BOT_DIR / "watchdog_restarts.json"
MAX_RESTARTS = 3
HEARTBEAT_MAX_AGE_SEC = 1200  # 20 min

sys.path.insert(0, str(BOT_DIR))
try:
    from signal_engine import config as _cfg
    TG_TOKEN = _cfg.TELEGRAM_TOKEN
    TG_CHAT  = _cfg.TELEGRAM_CHAT_ID
except Exception:
    TG_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
    TG_CHAT  = os.environ.get("TELEGRAM_CHAT_ID", "")


def tg_send(msg: str):
    import urllib.request
    if not TG_TOKEN or "YOUR_BOT" in TG_TOKEN:
        return
    try:
        url  = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": TG_CHAT, "text": msg, "parse_mode": "Markdown"}).encode()
        req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def is_bot_running() -> tuple:
    if not PID_FILE.exists():
        return False, 0
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)
        return True, pid
    except (ProcessLookupError, ValueError, OSError):
        return False, 0


def has_open_trade() -> bool:
    try:
        st = json.loads(STATE_FILE.read_text())
        return st.get("active_trade") is not None
    except Exception:
        return False


def get_restart_log() -> dict:
    if not RESTART_LOG.exists():
        return {"restarts": []}
    try:
        return json.loads(RESTART_LOG.read_text())
    except Exception:
        return {"restarts": []}


def save_restart_log(log: dict):
    RESTART_LOG.write_text(json.dumps(log, indent=2))


def restarts_in_last_hour(log: dict) -> int:
    now = time.time()
    return sum(1 for r in log["restarts"] if now - r["ts"] < 3600)


def restart_bot():
    subprocess.Popen(
        ["sudo", "systemctl", "start", "alphabot"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def main():
    running, pid   = is_bot_running()
    open_trade     = has_open_trade()
    log            = get_restart_log()
    recent_restarts = restarts_in_last_hour(log)

    if running:
        # Check heartbeat age
        try:
            st = json.loads(STATE_FILE.read_text())
            hb = st.get("last_heartbeat")
            if hb:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(hb)).total_seconds()
                if age > HEARTBEAT_MAX_AGE_SEC:
                    tg_send(
                        f"🟡 *Bot heartbeat stale* — {int(age/60)} min since last update. "
                        f"PID {pid} running but may be stuck."
                    )
        except Exception:
            pass
        return

    # Bot is DOWN
    if open_trade:
        tg_send(
            f"🔴 *CRITICAL — Bot is DOWN with open position!*\n\n"
            f"Process not found. Open trade at risk.\n"
            f"Check immediately — do NOT let this sit.\n\n"
            f"_Watchdog will NOT auto-restart with open position._"
        )
        return

    # No open trade — try to restart
    if recent_restarts >= MAX_RESTARTS:
        tg_send(
            f"🔴 *Bot restarted {recent_restarts}x in last hour — NOT restarting again.*\n"
            f"Manual intervention required."
        )
        return

    restart_bot()
    log["restarts"].append({"ts": time.time(), "reason": "watchdog_restart"})
    log["restarts"] = log["restarts"][-50:]
    save_restart_log(log)
    tg_send(f"🟡 *Bot restarted by watchdog* (restart #{recent_restarts + 1} this hour)")


if __name__ == "__main__":
    main()
