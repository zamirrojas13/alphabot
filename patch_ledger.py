#!/usr/bin/env python3
"""Patch ledger.py — Layer 3: backup, tmp-write, validate, load_from_backup."""
import re

LEDGER_PATH = "/home/ubuntu/btc-bot/signal_engine/ledger.py"

with open(LEDGER_PATH, "r", encoding="utf-8") as f:
    src = f.read()

NEW_SRC = '''# ═══════════════════════════════════════════════════════════════════
# CSV ledger — every executed trade is appended here.
# Same schema the AlphaBot dashboard reads.
# ═══════════════════════════════════════════════════════════════════
import csv
import shutil
from datetime import datetime
from . import config


COLUMNS = [
    "trade_id", "timestamp_entry", "timestamp_exit", "venue", "symbol", "timeframe",
    "direction", "setup_type", "primary_setup", "tier",
    "entry_price", "sl_price", "tp_price", "sl_distance_pct", "rr_target",
    "position_size_btc", "position_size_usd", "nano_qty", "max_risk_usd",
    "exit_price", "exit_reason", "bars_held",
    "pnl_usd", "pnl_pct", "r_multiple", "fees_usd", "pnl_net_usd",
    "venue_adapter", "dry_run", "notes",
]


def _row_from_trade(t: dict) -> dict:
    return {
        "trade_id":         t.get("order_id", ""),
        "timestamp_entry":  t.get("timestamp_entry", ""),
        "timestamp_exit":   t.get("timestamp_exit", ""),
        "venue":            t.get("venue", "coinbase_cfm"),
        "symbol":           config.SYMBOL,
        "timeframe":        t.get("tf", ""),
        "direction":        t.get("side", ""),
        "setup_type":       t.get("name", ""),
        "primary_setup":    t.get("desc", ""),
        "tier":             t.get("tier", ""),
        "entry_price":      t.get("entry", ""),
        "sl_price":         t.get("sl", ""),
        "tp_price":         t.get("tp", ""),
        "sl_distance_pct":  t.get("sl_pct", ""),
        "rr_target":        t.get("rr", ""),
        "position_size_btc":t.get("qty_btc", ""),
        "position_size_usd":t.get("qty_usd", ""),
        "nano_qty":         t.get("nano_qty", ""),
        "max_risk_usd":     t.get("max_risk_usd", ""),
        "exit_price":       t.get("exit_price", ""),
        "exit_reason":      t.get("exit_reason", ""),
        "bars_held":        t.get("bars_held", ""),
        "pnl_usd":          t.get("pnl_usd", ""),
        "pnl_pct":          t.get("pnl_pct", ""),
        "r_multiple":       t.get("r_multiple", ""),
        "fees_usd":         t.get("fees_usd", ""),
        "pnl_net_usd":      t.get("pnl_net_usd", ""),
        "venue_adapter":    t.get("venue_adapter", ""),
        "dry_run":          t.get("dry_run", ""),
        "notes":            t.get("reason", ""),
    }


def _backup_ledger():
    """Backup ledger, keep last 7 daily backups."""
    if not config.LEDGER_FILE.exists():
        return
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = config.LEDGER_FILE.parent / "ledger_backups"
    backup_dir.mkdir(exist_ok=True)
    shutil.copy2(config.LEDGER_FILE, backup_dir / f"trades_ledger_{ts}.csv")
    # Keep only latest backup per day, max 7 days
    backups = sorted(backup_dir.glob("trades_ledger_*.csv"))
    seen_days = {}
    for b in reversed(backups):
        day = b.stem[15:23]  # extract YYYYMMDD
        if day not in seen_days:
            seen_days[day] = b
    to_keep = set(seen_days.values())
    if len(to_keep) > 7:
        to_keep = set(sorted(to_keep)[-7:])
    for b in backups:
        if b not in to_keep:
            try:
                b.unlink()
            except Exception:
                pass


def validate_ledger():
    """Returns (is_valid: bool, message: str)."""
    if not config.LEDGER_FILE.exists():
        return True, "No ledger yet"
    try:
        rows = read_all()
        for i, r in enumerate(rows):
            if not r.get("trade_id"):
                return False, f"Row {i} missing trade_id"
        return True, f"Ledger OK — {len(rows)} trades"
    except Exception as e:
        return False, f"Ledger read error: {e}"


def load_from_backup():
    """Load from most recent backup. Returns list or None."""
    backup_dir = config.LEDGER_FILE.parent / "ledger_backups"
    if not backup_dir.exists():
        return None
    backups = sorted(backup_dir.glob("trades_ledger_*.csv"))
    if not backups:
        return None
    try:
        with open(backups[-1], "r", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except Exception:
        return None


def append(trade: dict) -> None:
    config.LEDGER_FILE.parent.mkdir(parents=True, exist_ok=True)
    _backup_ledger()
    tmp_path = config.LEDGER_FILE.with_suffix(".tmp")
    new_file = not config.LEDGER_FILE.exists()
    # Copy existing content to tmp first
    if not new_file:
        shutil.copy2(config.LEDGER_FILE, tmp_path)
        with open(tmp_path, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writerow(_row_from_trade(trade))
    else:
        with open(tmp_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            w.writerow(_row_from_trade(trade))
    tmp_path.replace(config.LEDGER_FILE)


def update_exit(trade_id: str, exit_data: dict) -> None:
    """Read all rows, update the matching trade_id with exit data, rewrite file."""
    if not config.LEDGER_FILE.exists():
        return
    _backup_ledger()
    rows = []
    with open(config.LEDGER_FILE, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        if r["trade_id"] == trade_id:
            for k, v in exit_data.items():
                if k in r:
                    r[k] = v
    tmp_path = config.LEDGER_FILE.with_suffix(".tmp")
    with open(tmp_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    tmp_path.replace(config.LEDGER_FILE)


def read_all() -> list:
    """Return all ledger rows as a list of dicts."""
    if not config.LEDGER_FILE.exists():
        return []
    with open(config.LEDGER_FILE, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))
'''

with open(LEDGER_PATH, "w", encoding="utf-8") as f:
    f.write(NEW_SRC)

print("ledger.py patched OK")
