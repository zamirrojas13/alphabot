"""AlphaBot dashboard server.
Serves static UI + REST endpoints that fetch live state from the Oracle bot via SSH.

Run:  python alphabot/serve.py
Open: http://localhost:8765
"""
import http.server, socketserver, json, csv, io, subprocess, sys, time, base64, os
from pathlib import Path
from urllib.parse import urlparse

CB_KEYS_FILE = Path(os.environ.get("ALPHABOT_KEYS_DIR", str(Path(__file__).parent / ".keys"))) / "coinbase.json"

def _load_cb_keys():
    if not CB_KEYS_FILE.exists(): return None, None
    try:
        d = json.loads(CB_KEYS_FILE.read_text())
        k = d.get("api_key",""); s = d.get("api_secret","")
        if "YOUR_API" in k or not k or not s: return None, None
        # Unescape \n sequences that may be stored as literal backslash-n
        s = s.replace("\\n", "\n")
        return k, s
    except: return None, None

def _make_cb_jwt(api_key, private_key_pem, method, path):
    """Build a Coinbase CDP JWT (ES256) without requiring PyJWT."""
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

        priv = serialization.load_pem_private_key(private_key_pem.encode(), password=None)

        def b64u(data):
            if isinstance(data, dict):
                data = json.dumps(data, separators=(',', ':')).encode()
            return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

        # JWT uri must NOT include query string
        path_only = path.split("?")[0]
        header  = {"alg": "ES256", "kid": api_key, "nonce": os.urandom(16).hex()}
        payload = {
            "sub": api_key, "iss": "cdp",
            "nbf": int(time.time()), "exp": int(time.time()) + 120,
            "uri": f"{method.upper()} api.coinbase.com{path_only}",
        }
        signing_input = f"{b64u(header)}.{b64u(payload)}"
        der_sig = priv.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der_sig)
        raw_sig = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
        return f"{signing_input}.{b64u(raw_sig)}", None
    except Exception as e:
        return None, str(e)

def _cb_request(method, path, body=""):
    """Signed request to Coinbase Advanced Trade REST API using CDP JWT."""
    import urllib.request as _ur
    api_key, api_secret = _load_cb_keys()
    if not api_key:
        return None, "No Coinbase API key configured"
    token, err = _make_cb_jwt(api_key, api_secret, method, path)
    if err:
        return None, f"JWT build failed: {err}"
    url = "https://api.coinbase.com" + path
    req = _ur.Request(url, method=method.upper())
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type",  "application/json")
    try:
        with _ur.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)

PORT = 8765
ROOT = Path(__file__).parent / "static"
ORACLE_KEY = str(Path(os.environ.get("ALPHABOT_KEYS_DIR", str(Path(__file__).parent / ".keys"))) / "oracle.key")
ORACLE_HOST = "ubuntu@163.192.100.135"

# Cache to avoid hammering SSH on every request
_CACHE = {"state": None, "trades": [], "ts": 0}
CACHE_TTL = 10  # seconds


def _ssh_run(cmd):
    """Run an arbitrary shell command on Oracle. Returns stdout or None."""
    if not Path(ORACLE_KEY).exists():
        return None
    try:
        r = subprocess.run(
            ["ssh", "-i", ORACLE_KEY, "-o", "StrictHostKeyChecking=no",
             "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR", "-q",
             ORACLE_HOST, cmd],
            capture_output=True, text=True, timeout=12,
        )
        return r.stdout if r.stdout.strip() else None
    except Exception:
        return None


def _ssh_cat(remote_path):
    return _ssh_run(f"cat {remote_path} 2>/dev/null || true")


def _parse_last_scan(log_text):
    """Find the most recent 'Scan @ YYYY-MM-DD HH:MM UTC' line in bot.log."""
    if not log_text:
        return None, 0
    last_scan = None
    scan_count = 0
    for line in log_text.splitlines():
        if "Scan @" in line:
            scan_count += 1
            # format:  Scan @ 2026-05-02 23:43 UTC
            try:
                ts = line.split("Scan @", 1)[1].strip().rstrip(" UTC").rstrip()
                last_scan = ts
            except:
                pass
    return last_scan, scan_count


def _refresh_cache():
    if time.time() - _CACHE["ts"] < CACHE_TTL:
        return
    state_text = _ssh_cat("/home/ubuntu/btc-bot/state.json")
    state = None
    if state_text:
        try: state = json.loads(state_text)
        except: pass

    # Enrich with scan info from bot.log
    log_text = _ssh_run("tail -200 /home/ubuntu/btc-bot/bot.log 2>/dev/null || true")
    last_scan, scan_count = _parse_last_scan(log_text)
    if state is not None:
        if last_scan:
            state["last_daily_scan_day"] = last_scan
        # Days since last signal — if last_signal_bar is None, set "Never"
        last_sig = state.get("last_signal_bar")
        if last_sig:
            try:
                from datetime import datetime, timezone
                d_last = datetime.fromisoformat(last_sig.replace("Z", "+00:00"))
                days = (datetime.now(timezone.utc) - d_last).days
                state["days_since_last_signal"] = days
            except: state["days_since_last_signal"] = None
        else:
            state["days_since_last_signal"] = "Never"
        state["scan_count_recent"] = scan_count

    trades = []
    for path in ["/home/ubuntu/btc-bot/btc-data/trades_ledger_v2.csv",
                 "/home/ubuntu/btc-bot/trades_ledger_v2.csv"]:
        t = _ssh_cat(path)
        if t and "trade_id" in t:
            for row in csv.DictReader(io.StringIO(t)):
                for k in ("entry_price","sl_price","tp_price","position_size_btc","position_size_usd",
                          "nano_qty","max_risk_usd","exit_price","bars_held","pnl_usd","pnl_pct",
                          "r_multiple","fees_usd","pnl_net_usd","tier","sl_distance_pct","rr_target"):
                    v = row.get(k)
                    if v not in (None, "", "None"):
                        try: row[k] = float(v)
                        except: pass
                row["open"] = not row.get("exit_price")
                trades.append(row)
            break

    # Inject dry_run flag so dashboard can show paper mode banner
    if state is not None:
        active = state.get("active_trade", {}) or {}
        state["dry_run"] = active.get("dry_run", True)  # default True until confirmed live

    _CACHE["state"]  = state
    _CACHE["trades"] = trades
    _CACHE["ts"]     = time.time()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".jsx": "application/javascript",
        ".js":  "application/javascript",
    }

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            _refresh_cache()
            return self._send_json(_CACHE["state"] or {"err": "oracle unreachable"})
        if path == "/api/trades":
            _refresh_cache()
            return self._send_json({"trades": _CACHE["trades"]})
        if path == "/api/ticker":
            import urllib.request
            try:
                with urllib.request.urlopen(
                    "https://api.exchange.coinbase.com/products/BTC-USD/ticker", timeout=8
                ) as resp:
                    ticker = json.loads(resp.read())
                # also fetch 24h stats for open price
                try:
                    with urllib.request.urlopen(
                        "https://api.exchange.coinbase.com/products/BTC-USD/stats", timeout=8
                    ) as resp2:
                        stats = json.loads(resp2.read())
                        ticker["open"] = stats.get("open")
                except Exception:
                    pass
                return self._send_json(ticker)
            except Exception as e:
                return self._send_json({"err": str(e)}, 500)
        if path == "/api/telegram":
            import urllib.request as _ur
            # Check if the bot process is running on Oracle
            proc_raw = _ssh_run(
                "pgrep -fa 'python.*bot' 2>/dev/null | grep -v grep | head -3"
            )
            connected = bool(proc_raw and proc_raw.strip())
            bot_username = None

            # Also try to get bot username from token (best-effort, non-blocking)
            token_raw = _ssh_run(
                "grep -rEh 'TELEGRAM_TOKEN|BOT_TOKEN|telegram_token|bot_token' "
                "/home/ubuntu/btc-bot/ 2>/dev/null | "
                "grep -oP '[0-9]{8,}:[A-Za-z0-9_-]{30,}' | head -1"
            )
            if token_raw and token_raw.strip():
                token = token_raw.strip()
                try:
                    with _ur.urlopen(
                        f"https://api.telegram.org/bot{token}/getMe", timeout=8
                    ) as r:
                        d = json.loads(r.read())
                        if d.get("ok"):
                            connected = True   # override if token also valid
                            bot_username = d["result"].get("username")
                except Exception:
                    pass
            # 2. Parse bot.log for lines where Telegram messages were sent
            log_raw = _ssh_run(
                "grep -E 'Telegram|telegram|Brief|📋|📈|📉|🔍|Signal Alert|Morning|Scan result|Sent to' "
                "/home/ubuntu/btc-bot/bot.log 2>/dev/null | tail -300"
            )
            messages = []
            if log_raw:
                for line in log_raw.splitlines():
                    line = line.strip()
                    if line:
                        messages.append({"raw": line})
            return self._send_json({
                "connected": connected,
                "bot_username": bot_username,
                "messages": messages,
                "count": len(messages),
            })
        if path == "/api/coinbase":
            return self._handle_coinbase()
        if path == "/api/trading_mode":
            return self._handle_trading_mode_get()
        if path == "/api/backtest":
            return self._handle_backtest()
        if path == "/api/strategies":
            raw = _ssh_cat("/home/ubuntu/btc-bot/strategy_registry.json")
            if raw:
                try: return self._send_json(json.loads(raw))
                except: pass
            return self._send_json({"err": "registry not available"})
        if path == "/api/health":
            return self._send_json({"ok": True, "ts": int(time.time()),
                                     "cache_age_s": int(time.time() - _CACHE["ts"])})
        return super().do_GET()

    def _handle_coinbase(self):
        api_key, _ = _load_cb_keys()
        if not api_key:
            return self._send_json({"configured": False,
                "msg": "Add your API key to .keys/coinbase.json"})

        # Fetch accounts
        accounts_data, err = _cb_request("GET", "/api/v3/brokerage/accounts")
        if err or not accounts_data:
            return self._send_json({"configured": True, "err": err or "empty response"})

        accounts = accounts_data.get("accounts", [])
        # Pull BTC and USD (USDC) balances
        result = {"configured": True, "accounts": [], "btc": None, "usd": None, "total_usd": None}
        btc_price = None

        # Get live BTC price for USD valuation
        try:
            import urllib.request as _ur
            with _ur.urlopen("https://api.exchange.coinbase.com/products/BTC-USD/ticker", timeout=6) as r:
                btc_price = float(json.loads(r.read()).get("price", 0))
        except: pass

        CASH_CURRENCIES = {"USD", "USDC", "USDT", "USDT-E"}
        cash_total = 0.0
        for acc in accounts:
            currency = acc.get("currency", "")
            avail = float(acc.get("available_balance", {}).get("value", 0) or 0)
            hold  = float(acc.get("hold", {}).get("value", 0) or 0)
            total = avail + hold
            if total == 0: continue
            result["accounts"].append({
                "currency": currency,
                "available": round(avail, 8),
                "hold":      round(hold, 8),
                "total":     round(total, 8),
            })
            if currency == "BTC":
                result["btc"] = round(total, 8)
            if currency in CASH_CURRENCIES:
                cash_total += total
                result["usd"] = round(cash_total, 2)

        # total_usd = cash/stablecoins only (no crypto valuation)
        result["total_usd"] = round(cash_total, 2)
        result["btc_price"] = round(btc_price, 2) if btc_price else None

        # Fetch open orders
        orders_data, _ = _cb_request("GET", "/api/v3/brokerage/orders/historical/batch?order_status=OPEN&limit=25")
        open_orders = []
        if orders_data:
            for o in orders_data.get("orders", []):
                open_orders.append({
                    "order_id":   o.get("order_id"),
                    "product_id": o.get("product_id"),
                    "side":       o.get("side"),
                    "type":       o.get("order_type"),
                    "size":       o.get("order_configuration", {}).get("limit_limit_gtc", {}).get("base_size") or
                                  o.get("order_configuration", {}).get("market_market_ioc", {}).get("base_size"),
                    "price":      o.get("order_configuration", {}).get("limit_limit_gtc", {}).get("limit_price"),
                    "status":     o.get("status"),
                })
        result["open_orders"] = open_orders

        # Fetch recent fills (last 25)
        fills_data, _ = _cb_request("GET", "/api/v3/brokerage/orders/historical/fills?limit=25")
        fills = []
        if fills_data:
            for f in fills_data.get("fills", []):
                fills.append({
                    "trade_id":   f.get("trade_id"),
                    "product_id": f.get("product_id"),
                    "side":       f.get("side"),
                    "price":      float(f.get("price", 0)),
                    "size":       float(f.get("size", 0)),
                    "fee":        float(f.get("commission", 0)),
                    "time":       f.get("trade_time","")[:19].replace("T"," "),
                })
        result["recent_fills"] = fills

        return self._send_json(result)

    def _handle_backtest(self):
        import datetime as _dt
        from collections import defaultdict
        BT_CSV = Path(__file__).parent.parent / "btc-data" / "scheme_i_plus_trades.csv"
        if not BT_CSV.exists():
            return self._send_json({"err": "Backtest file not found"}, 404)

        rows = list(csv.DictReader(open(BT_CSV, encoding="utf-8")))
        START = 10_000.0
        reason_map = {"sl_hit":"sl","tp_hit":"tp","trail_stop":"trail","time_exit":"time"}

        trades = []
        for i, r in enumerate(rows):
            try:
                eq  = float(r.get("equity") or 0)
                eq0 = float(r.get("equity_prev") or 0)
            except: eq = eq0 = 0
            pnl = round(eq - eq0, 2)
            entry_t = r.get("t","") or r.get("timestamp_entry","") or ""
            exit_t  = r.get("timestamp_exit","") or entry_t
            try: tier = int(float(r.get("tier", 1) or 1))
            except: tier = 1
            try: r_mult = float(r.get("r_multiple") or 0)
            except: r_mult = 0.0
            try: bars = int(float(r.get("bars_held") or 0))
            except: bars = 0
            try: entry_p = float(r.get("entry_price") or 0)
            except: entry_p = 0.0
            try: exit_p = float(r.get("exit_price") or 0)
            except: exit_p = 0.0
            trades.append({
                "trade_id":        f"BT-{i+1:04d}",
                "timestamp_entry": entry_t,
                "timestamp_exit":  exit_t,
                "direction":       r.get("direction","long"),
                "setup_type":      r.get("strat","") or r.get("setup_type",""),
                "tier":            tier,
                "entry_price":     entry_p,
                "exit_price":      exit_p,
                "exit_reason":     reason_map.get(r.get("exit_reason",""), r.get("exit_reason","")),
                "r_multiple":      r_mult,
                "bars_held":       bars,
                "pnl_net_usd":     pnl,
                "pnl_usd":         pnl,
                "fees_usd":        0.0,
                "balance_after":   round(eq, 2),
                "open":            False,
                "grade":           None,
            })

        wins   = [t for t in trades if t["r_multiple"] > 0]
        losses = [t for t in trades if t["r_multiple"] <= 0]
        total_r = sum(t["r_multiple"] for t in trades)
        avg_r   = round(total_r / len(trades), 3) if trades else 0
        win_rate = round(len(wins) / len(trades) * 100) if trades else 0
        final_eq = float(rows[-1].get("equity", START)) if rows else START

        peak, max_dd_pct = START, 0.0
        for t in trades:
            bal = t["balance_after"]
            if bal > peak: peak = bal
            dd = (bal - peak) / peak * 100 if peak > 0 else 0
            if dd < max_dd_pct: max_dd_pct = dd

        daily = defaultdict(float)
        for t in trades:
            daily[t["timestamp_entry"][:10]] += t["pnl_net_usd"]
        sorted_days = sorted(daily)
        daily_pnl = {d: round(daily[d], 2) for d in sorted_days}

        hrly = defaultdict(lambda: {"wins": 0, "losses": 0})
        for t in trades:
            try:
                h = (int(t["timestamp_entry"][11:13]) // 4) * 4
                key = f"{h:02d}:00"
                if t["r_multiple"] > 0: hrly[key]["wins"] += 1
                else:                   hrly[key]["losses"] += 1
            except: pass
        hourly_stats = [{"hour": k, "label": k, **v} for k, v in sorted(hrly.items())]

        days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
        dow = defaultdict(lambda: {"wins": 0, "losses": 0, "r": 0.0})
        for t in trades:
            try:
                d = _dt.datetime.strptime(t["timestamp_entry"][:10], "%Y-%m-%d").weekday()
                dow[days[d]]["wins"]   += t["r_multiple"] > 0
                dow[days[d]]["losses"] += t["r_multiple"] <= 0
                dow[days[d]]["r"]      += t["r_multiple"]
            except: pass
        dow_stats = [{"day": d, "wins": dow[d]["wins"], "losses": dow[d]["losses"],
                      "total_r": round(dow[d]["r"], 2)} for d in days]

        sm = defaultdict(lambda: {"wins": 0, "losses": 0, "wr": 0.0, "lr": 0.0})
        for t in trades:
            s = t["setup_type"]
            if t["r_multiple"] > 0: sm[s]["wins"] += 1; sm[s]["wr"] += t["r_multiple"]
            else:                   sm[s]["losses"] += 1; sm[s]["lr"] += abs(t["r_multiple"])
        ev_by_setup = []
        for s, v in sm.items():
            tot = v["wins"] + v["losses"]
            wr  = v["wins"] / tot if tot else 0
            aw  = round(v["wr"] / v["wins"], 2)   if v["wins"]   else 0
            al  = round(v["lr"] / v["losses"], 2) if v["losses"] else 0
            ev  = round(wr * aw - (1 - wr) * al, 2)
            ev_by_setup.append({"type": s, "total": tot, "wr": round(wr, 3),
                                 "avgW": aw, "avgL": al, "ev": ev})
        ev_by_setup.sort(key=lambda x: -x["ev"])

        month_eq = {}
        for t in trades:
            m = t["timestamp_entry"][:7]
            month_eq.setdefault(m, {"start": t["balance_after"], "end": t["balance_after"]})
            month_eq[m]["end"] = t["balance_after"]
        session_dd = [{"date": m, "start": v["start"], "end": v["end"],
                       "dd": round((min(v["end"],v["start"])-v["start"])/v["start"]*100,2) if v["start"] else 0}
                      for m, v in sorted(month_eq.items())[-20:]]

        equity_curve = [{"v": START}] + [{"v": t["balance_after"]} for t in trades]
        setup_stats = {}
        for t in trades:
            s = t["setup_type"]
            if s not in setup_stats: setup_stats[s] = {"w": 0, "l": 0}
            if t["r_multiple"] > 0: setup_stats[s]["w"] += 1
            else:                   setup_stats[s]["l"] += 1

        return self._send_json({
            "trades":       trades,
            "equity":       equity_curve,
            "account":      {"account_size": START, "equity": round(final_eq,2),
                             "buying_power": round(final_eq,2), "cash": round(final_eq,2)},
            "stats":        {"total_r": round(total_r,2), "avg_r": avg_r,
                             "win_rate": win_rate, "wins": len(wins), "losses": len(losses),
                             "max_dd_pct": round(max_dd_pct,2), "max_drawdown": round(abs(max_dd_pct),2),
                             "return_pct": round((final_eq-START)/START*100,2),
                             "total_net_pnl": round(final_eq-START,2),
                             "closed_trades": len(trades),
                             "grades": {}, "setupStats": setup_stats},
            "bot_state":    {"loss_streak":0,"tier_restricted":False,
                             "trade_pending":False,"active_trade":None,"account_size":START},
            "daily_pnl":    daily_pnl,
            "hourly_stats": hourly_stats,
            "dow_stats":    dow_stats,
            "ev_by_setup":  ev_by_setup,
            "session_dd":   session_dd,
            "position":     {"symbol":"BTC/USD","qty":0,"side":"flat",
                             "unrealized_pl":0,"avg_entry_price":0,
                             "current_price":0,"unrealized_plpc":0},
            "config":       {"TIER_RISK_PCT":{1:7.0,2:5.0,3:3.0},"RUN_INTERVAL_MINUTES":15},
            "date_range":   {"start": rows[0].get("t","")[:10] if rows else "",
                             "end":   rows[-1].get("t","")[:10] if rows else ""},
        })

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try: payload = json.loads(body)
        except: payload = {}
        if path == "/api/trading_mode":
            return self._handle_trading_mode_set(payload)
        self.send_response(404)
        self.end_headers()

    _MODE_FILE = Path(__file__).parent / ".keys" / "trading_mode.json"

    def _handle_trading_mode_get(self):
        try:
            d = json.loads(self._MODE_FILE.read_text()) if self._MODE_FILE.exists() else {}
        except: d = {}
        return self._send_json({
            "mode": d.get("mode", "paper"),
            "changed_at": d.get("changed_at", None),
            "changed_by": d.get("changed_by", None),
        })

    def _handle_trading_mode_set(self, payload):
        mode = payload.get("mode", "paper")
        if mode not in ("paper", "live"):
            return self._send_json({"err": "invalid mode"}, 400)
        record = {
            "mode": mode,
            "changed_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "changed_by": "dashboard",
        }
        self._MODE_FILE.write_text(json.dumps(record, indent=2))
        # Best-effort: propagate to Oracle bot via SSH flag file
        flag = "LIVE" if mode == "live" else "PAPER"
        _ssh_run(f"echo '{flag}' > /home/ubuntu/btc-bot/trading_mode.txt 2>/dev/null || true")
        return self._send_json({"ok": True, "mode": mode})

    def log_message(self, fmt, *args):
        a0, a1 = str(args[0]) if args else "", str(args[1]) if len(args) > 1 else ""
        if "/api/" in a0 or a1 not in ("200", "304"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


import os
os.chdir(ROOT)
class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

with ThreadedServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"AlphaBot dashboard -> http://localhost:{PORT}")
    print(f"  Oracle bot: {ORACLE_HOST}")
    print(f"  Live endpoints: /api/state /api/trades /api/health")
    print(f"  Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
