#!/usr/bin/env python3
"""Patch telegram_alerts.py — Layer 6: alert hierarchy functions."""
import time as _time_mod

TG_PATH = "/home/ubuntu/btc-bot/signal_engine/telegram_alerts.py"

with open(TG_PATH, "r", encoding="utf-8") as f:
    src = f.read()

# Add `import time` if not already present
if "\nimport time\n" not in src and "import time" not in src.split("\n")[:10]:
    src = src.replace("import requests\n", "import requests\nimport time\n", 1)

HIERARCHY_CODE = '''
# ── Alert hierarchy (Layer 6) ─────────────────────────────────────
_critical_alerts: dict = {}   # key -> last_sent timestamp
_warning_sent: set = set()    # keys already sent


def send_critical(msg: str, key: str = None):
    """🔴 CRITICAL: repeats every 15 min until key changes."""
    key = key or msg[:50]
    last = _critical_alerts.get(key, 0)
    if time.time() - last > 900:  # 15 min
        _critical_alerts[key] = time.time()
        send_message(f"🔴 *CRITICAL*\\n\\n{msg}")


def send_warning(msg: str, key: str = None):
    """🟡 WARNING: sends once only per key."""
    key = key or msg[:50]
    if key not in _warning_sent:
        _warning_sent.add(key)
        send_message(f"🟡 *WARNING*\\n\\n{msg}")


def send_info(msg: str):
    """ℹ️ INFO: normal operations, send once."""
    send_message(msg)
'''

# Append at end of file (before final newline if any)
src = src.rstrip() + "\n" + HIERARCHY_CODE + "\n"

with open(TG_PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("telegram_alerts.py patched OK")
