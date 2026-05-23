#!/usr/bin/env python3
"""
reconcile.py — Match bot alert log entries against Coinbase fills.

Reads: /home/ubuntu/btc-bot/logs/bot.log  (ENTRY / EXIT alert lines)
       Coinbase fills API (last 100 fills for BTC-USD-INTX)
Writes: reconcile.csv in the current directory

Cron: 55 23 * * * cd /home/ubuntu/btc-bot && set -a && source .env && set +a &&
      /usr/bin/python3 reconcile.py >> logs/reconcile.log 2>&1

Output:
  Reconciled X trades | Avg slippage: X% | Total fees: $X
"""

import os, csv, sys, re, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
import urllib.request, urllib.parse

# ── Paths + config ──────────────────────────────────────────────────────────
BOT_DIR   = Path("/home/ubuntu/btc-bot")
LOG_FILE  = BOT_DIR / "logs" / "bot.log"
CSV_OUT   = Path("reconcile.csv")

TG_TOKEN  = os.environ.get("TELEGRAM_TOKEN", os.environ.get("TELEGRAM_BOT_TOKEN", ""))
TG_CHAT   = os.environ.get("TELEGRAM_CHAT_ID", "")
CB_KEY    = os.environ.get("COINBASE_API_KEY", "")
CB_SECRET = os.environ.get("COINBASE_API_SECRET", "")

MATCH_WINDOW_SECS = 300   # 5 minutes — fills within this of the alert timestamp

# ── 1. Parse ENTRY / EXIT alerts from bot.log ──────────────────────────────
ENTRY_RE = re.compile(
    r'(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})'
    r'.*?(?:ENTRY|entry alert|Signal Alert|entry_price)[^\d]*'
    r'(\w[\w_]+)\s+'           # strategy
    r'(long|short|BUY|SELL)'   # side
    r'.*?(?:entry|price)[=:\s]+\$?([\d,]+\.?\d*)',
    re.IGNORECASE,
)
EXIT_RE = re.compile(
    r'(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})'
    r'.*?(?:EXIT|trade closed|tp_hit|sl_hit|trail_stop)'
    r'.*?(?:exit|price|close)[=:\s]+\$?([\d,]+\.?\d*)'
    r'.*?(?:R|r_multiple)[=:\s]+([-+]?\d+\.?\d*)',
    re.IGNORECASE,
)

def _parse_ts(s):
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def parse_alerts(log_path: Path):
    if not log_path.exists():
        print(f"[reconcile] LOG NOT FOUND: {log_path}", file=sys.stderr)
        return []

    entries, exits = [], []
    for line in log_path.read_text(errors="replace").splitlines():
        m = ENTRY_RE.search(line)
        if m:
            ts = _parse_ts(m.group(1))
            if ts:
                entries.append({
                    "ts": ts,
                    "strategy": m.group(2),
                    "side": "BUY" if m.group(3).lower() in ("long","buy") else "SELL",
                    "alert_price": float(m.group(4).replace(",","")),
                })
            continue
        m = EXIT_RE.search(line)
        if m:
            ts = _parse_ts(m.group(1))
            if ts:
                exits.append({
                    "ts": ts,
                    "alert_price": float(m.group(2).replace(",","")),
                    "expected_R":  float(m.group(3)),
                })

    # Pair entries with exits chronologically
    records = []
    ei = 0
    for entry in sorted(entries, key=lambda x: x["ts"]):
        # Find next exit after entry
        matching_exit = None
        for ex in sorted(exits, key=lambda x: x["ts"]):
            if ex["ts"] > entry["ts"]:
                matching_exit = ex
                break
        records.append({"entry": entry, "exit": matching_exit})
        ei += 1

    return records


# ── 2. Fetch Coinbase fills ────────────────────────────────────────────────
def fetch_cb_fills():
    """Pull last 100 fills for BTC-USD-INTX from Coinbase API."""
    try:
        import hmac, hashlib, time as _t
        product = "BTC-USDC"
        ts = str(int(_t.time()))
        method = "GET"
        path = f"/api/v3/brokerage/orders/historical/fills?product_id={product}&limit=100"
        msg = f"{ts}{method}{path}".encode()
        sig = hmac.new(CB_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        req = urllib.request.Request(
            "https://api.coinbase.com" + path,
            headers={
                "CB-ACCESS-KEY":       CB_KEY,
                "CB-ACCESS-SIGN":      sig,
                "CB-ACCESS-TIMESTAMP": ts,
                "Content-Type":        "application/json",
            },
        )
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        fills = []
        for f in data.get("fills", []):
            try:
                fills.append({
                    "ts":    datetime.fromisoformat(f["trade_time"].rstrip("Z")).replace(tzinfo=timezone.utc),
                    "side":  f["side"],
                    "price": float(f["price"]),
                    "size":  float(f["size"]),
                    "fee":   float(f.get("commission", 0)),
                })
            except Exception:
                pass
        return fills
    except Exception as e:
        print(f"[reconcile] Coinbase fills fetch failed: {e}", file=sys.stderr)
        return []


# ── 3. Match alerts to fills ────────────────────────────────────────────────
def match(records, fills):
    matched = []
    for rec in records:
        entry = rec["entry"]
        ex    = rec["exit"]

        # Find closest fill within MATCH_WINDOW_SECS of entry alert
        best_entry_fill = None
        best_dt = timedelta(seconds=MATCH_WINDOW_SECS + 1)
        for f in fills:
            if f["side"] == entry["side"]:
                dt = abs(f["ts"] - entry["ts"])
                if dt < best_dt:
                    best_dt = dt
                    best_entry_fill = f

        entry_fill_price = best_entry_fill["price"] if best_entry_fill else None
        entry_fee        = best_entry_fill["fee"]   if best_entry_fill else 0.0

        # Slippage
        if entry_fill_price and entry["alert_price"]:
            slip_pct = (entry_fill_price - entry["alert_price"]) / entry["alert_price"] * 100
            if entry["side"] == "SELL":
                slip_pct = -slip_pct  # for shorts, higher fill = better
        else:
            slip_pct = None

        # Exit fill
        exit_fill_price, exit_fee = None, 0.0
        if ex:
            exit_side = "SELL" if entry["side"] == "BUY" else "BUY"
            best_exit_fill = None
            best_dt = timedelta(seconds=MATCH_WINDOW_SECS + 1)
            for f in fills:
                if f["side"] == exit_side:
                    dt = abs(f["ts"] - ex["ts"])
                    if dt < best_dt:
                        best_dt = dt
                        best_exit_fill = f
            exit_fill_price = best_exit_fill["price"] if best_exit_fill else None
            exit_fee        = best_exit_fill["fee"]   if best_exit_fill else 0.0

        # Actual R from fills
        actual_R = None
        if entry_fill_price and exit_fill_price and ex:
            direction = 1 if entry["side"] == "BUY" else -1
            # Estimate actual R relative to expected R
            fill_pnl_pct  = direction * (exit_fill_price - entry_fill_price) / entry_fill_price
            alert_pnl_pct = direction * (ex["alert_price"] - entry["alert_price"]) / entry["alert_price"]
            if alert_pnl_pct != 0:
                actual_R = round(ex["expected_R"] * fill_pnl_pct / alert_pnl_pct, 3)

        matched.append({
            "date":         entry["ts"].strftime("%Y-%m-%d"),
            "strategy":     entry["strategy"],
            "side":         entry["side"],
            "alert_price":  entry["alert_price"],
            "fill_price":   entry_fill_price,
            "slippage_pct": round(slip_pct, 4) if slip_pct is not None else "",
            "expected_R":   ex["expected_R"] if ex else "",
            "actual_R":     actual_R if actual_R is not None else "",
            "fee_usd":      round(entry_fee + exit_fee, 4),
        })
    return matched


# ── 4. Write CSV ────────────────────────────────────────────────────────────
FIELDNAMES = ["date","strategy","side","alert_price","fill_price",
              "slippage_pct","expected_R","actual_R","fee_usd"]

def write_csv(rows, path: Path):
    existing = set()
    if path.exists():
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                existing.add((r.get("date",""), r.get("strategy",""), r.get("side","")))

    new_rows = [r for r in rows if (r["date"], r["strategy"], r["side"]) not in existing]

    mode = "a" if path.exists() else "w"
    with open(path, mode, newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if mode == "w":
            w.writeheader()
        w.writerows(new_rows)
    return len(new_rows)


# ── 5. Main ─────────────────────────────────────────────────────────────────
def main():
    print(f"[reconcile] Reading alerts from {LOG_FILE}")
    records = parse_alerts(LOG_FILE)
    print(f"[reconcile] Found {len(records)} entry alerts")

    fills = []
    if CB_KEY and CB_SECRET:
        fills = fetch_cb_fills()
        print(f"[reconcile] Fetched {len(fills)} Coinbase fills")
    else:
        print("[reconcile] No Coinbase credentials — skipping fill matching")

    matched = match(records, fills)
    added   = write_csv(matched, CSV_OUT)

    # Summary stats
    slippages = [r["slippage_pct"] for r in matched if r["slippage_pct"] != ""]
    fees      = sum(r["fee_usd"] for r in matched)
    avg_slip  = sum(slippages) / len(slippages) if slippages else 0

    print(f"Reconciled {len(matched)} trades | "
          f"Avg slippage: {avg_slip:.3f}% | "
          f"Total fees: ${fees:.2f} | "
          f"New rows written: {added}")


if __name__ == "__main__":
    main()
