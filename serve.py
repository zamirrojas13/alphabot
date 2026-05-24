"""AlphaBot dashboard server.
Serves static UI + REST endpoints that fetch live state from the Oracle bot via SSH.

Run:  python alphabot/serve.py
Open: http://localhost:8765
"""
BOT_VERSION = "2.5.0"

import http.server, socketserver, json, csv, io, subprocess, sys, time, base64, os, argparse
from pathlib import Path
from urllib.parse import urlparse

_args = argparse.ArgumentParser(add_help=False)
_args.add_argument('--quiet', action='store_true')
_QUIET = _args.parse_known_args()[0].quiet

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

# Cache — refreshed by a background thread every 30s. HTTP handlers read only.
import threading as _threading
_CACHE = {"state": None, "trades": [], "ts": 0}
_START_TIME = time.time()   # for /health uptime_seconds
_CACHE_LOCK = _threading.Lock()
CACHE_TTL = 30  # seconds


def _ssh_run(cmd):
    """Run an arbitrary shell command on Oracle. Returns stdout or None."""
    if not Path(ORACLE_KEY).exists():
        return None
    try:
        r = subprocess.run(
            ["ssh", "-i", ORACLE_KEY, "-o", "StrictHostKeyChecking=no",
             "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR", "-q",
             ORACLE_HOST, cmd],
            capture_output=True, text=True, timeout=12, encoding="utf-8",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
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
    """Fetch state + trades from Oracle via SSH. Called only by background thread."""
    if not _CACHE_LOCK.acquire(blocking=False):
        return  # another refresh already running — skip
    try:
        _refresh_cache_inner()
    finally:
        _CACHE_LOCK.release()


def _refresh_cache_inner():
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
    for path in ["/home/ubuntu/btc-data/trades_ledger_v2.csv",
                 "/home/ubuntu/btc-bot/btc-data/trades_ledger_v2.csv",
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

    # Estimate Coinbase taker fees for closed trades missing fees_usd
    # Coinbase Advanced Trade taker rate: 0.06% per fill, 2 fills per round trip
    CB_TAKER = 0.0006
    for trade in trades:
        try:
            if trade.get("exit_price") in (None, "", "None"):
                continue  # open trade
            existing_fee = trade.get("fees_usd")
            if existing_fee not in (None, "", "None", 0, 0.0) and float(existing_fee or 0) > 0:
                continue  # already has fees
            qty    = float(trade.get("nano_qty") or trade.get("position_size_btc") or 0)
            entry  = float(trade.get("entry_price") or 0)
            exit_p = float(trade.get("exit_price") or 0)
            if qty > 0 and entry > 0:
                est = round((entry * qty + exit_p * qty) * CB_TAKER, 4)
                trade["fees_usd"]    = est
                trade["pnl_net_usd"] = round(float(trade.get("pnl_usd") or 0) - est, 2)
        except Exception:
            pass

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
        try:
            self._do_GET_inner()
        except Exception as _e:
            try:
                import traceback
                _err = traceback.format_exc()
                if sys.stderr:
                    sys.stderr.write(f"[Handler ERROR] {_e}\n{_err}\n")
            except Exception:
                pass
            try:
                self.send_error(500, str(_e))
            except Exception:
                pass

    def _do_GET_inner(self):
        path = urlparse(self.path).path
        if path == "/favicon.ico":
            self.send_response(204); self.end_headers(); return
        # ── AlphaBrain read-only endpoints ────────────────────────────────────
        if path == "/api/brain/levels":
            fp = Path(__file__).parent / 'brain_levels.json'
            try:
                payload = json.loads(fp.read_text(encoding='utf-8')) if fp.exists() else {"levels": [], "last_updated": None}
                return self._send_json(payload)
            except Exception as e:
                return self._send_json({"err": str(e)}, 500)
        if path == "/api/brain/state":
            fp = Path(__file__).parent / 'brain_state.json'
            try:
                payload = json.loads(fp.read_text(encoding='utf-8')) if fp.exists() else {}
                return self._send_json(payload)
            except Exception as e:
                return self._send_json({"err": str(e)}, 500)
        if path == "/api/brain/trades":
            fp = Path(__file__).parent / 'brain_trades.csv'
            if not fp.exists():
                return self._send_json({"trades": []})
            try:
                trades = []
                with open(fp, newline='', encoding='utf-8') as f:
                    for row in csv.DictReader(f):
                        for k in ("entry", "sl", "goal_1", "goal_2", "goal_3",
                                  "exit_price", "r_multiple", "pnl_usd", "level_price"):
                            v = row.get(k)
                            if v not in (None, "", "None"):
                                try: row[k] = float(v)
                                except: pass
                        row["open"] = not row.get("exit_price")
                        trades.append(row)
                return self._send_json({"trades": trades})
            except Exception as e:
                return self._send_json({"err": str(e)}, 500)
        # ── End Brain endpoints ────────────────────────────────────────────────
        if path == "/api/chart/history":
            from urllib.parse import parse_qs
            qs    = parse_qs(urlparse(self.path).query)
            tf    = qs.get('tf',    ['4h'])[0].lower()
            limit = int(qs.get('limit', ['5000'])[0])
            tf_file = {'1h':'btcusdt_1h','4h':'btcusdt_4h','1d':'btcusdt_1d','1w':'btcusdt_1w'}.get(tf,'btcusdt_4h')
            pq = Path(__file__).parent.parent / 'btc-data' / f'{tf_file}.parquet'
            if not pq.exists():
                return self._send_json({'err': f'{tf_file}.parquet not found'}, 404)
            try:
                import pandas as pd
                df = pd.read_parquet(pq, columns=['datetime','open','high','low','close','volume'])
                if limit > 0: df = df.tail(limit)
                candles = []
                for _, row in df.iterrows():
                    ts = row['datetime']
                    t  = int(ts.timestamp()) if hasattr(ts,'timestamp') else int(ts)
                    candles.append({'time':t,'open':round(float(row['open']),2),
                                    'high':round(float(row['high']),2),'low':round(float(row['low']),2),
                                    'close':round(float(row['close']),2),'volume':round(float(row['volume']),4)})
                return self._send_json({'candles': candles})
            except Exception as e:
                return self._send_json({'err': str(e)}, 500)
        if path == "/api/signals":
            st = _CACHE.get("state") or {}
            return self._send_json({
                "patterns":       st.get("patterns", []),
                "last_scan_time": st.get("last_scan") or st.get("last_heartbeat"),
            })
        if path == "/api/state":
            return self._send_json(_CACHE["state"] or {"err": "oracle unreachable"})
        if path == "/api/trades":
            return self._send_json({"trades": _CACHE["trades"]})
        if path == "/api/ticker":
            import urllib.request
            _hdrs = {"User-Agent": "AlphaBot/2.0"}
            try:
                with urllib.request.urlopen(
                    urllib.request.Request(
                        "https://api.exchange.coinbase.com/products/BTC-USD/ticker", headers=_hdrs
                    ), timeout=8
                ) as resp:
                    ticker = json.loads(resp.read())
                # also fetch 24h stats for open price
                try:
                    with urllib.request.urlopen(
                        urllib.request.Request(
                            "https://api.exchange.coinbase.com/products/BTC-USD/stats", headers=_hdrs
                        ), timeout=8
                    ) as resp2:
                        stats = json.loads(resp2.read())
                        ticker["open"] = stats.get("open")
                except Exception:
                    pass
                # Fetch front-month CFM nano futures price for basis display
                try:
                    futures_list_url = (
                        "https://api.coinbase.com/api/v3/brokerage/market/products"
                        "?product_type=FUTURE"
                    )
                    with urllib.request.urlopen(
                        urllib.request.Request(futures_list_url, headers=_hdrs), timeout=10
                    ) as fr:
                        from datetime import datetime, timezone as _tz
                        now = datetime.now(_tz.utc)
                        candidates = []
                        for p in json.loads(fr.read()).get("products", []):
                            pid = p.get("product_id", "")
                            if not (pid.startswith("BIT-") and pid.endswith("-CDE")):
                                continue
                            det = (p.get("future_product_details") or {})
                            exp_s = det.get("contract_expiry", "")
                            try:
                                exp = datetime.fromisoformat(exp_s.replace("Z", "+00:00"))
                                if exp > now:
                                    candidates.append((exp, pid, float(p.get("price", 0) or 0)))
                            except Exception:
                                pass
                        if candidates:
                            candidates.sort()
                            _, sym, fut_price = candidates[0]
                            spot = float(ticker.get("price", 0) or 0)
                            ticker["futures_contract"] = sym
                            ticker["futures_price"] = fut_price
                            ticker["futures_basis"] = round(fut_price - spot, 2) if spot else None
                except Exception:
                    pass
                return self._send_json(ticker)
            except Exception as e:
                return self._send_json({"err": str(e)}, 500)
        if path == "/api/telegram":
            # Bot alive? Use cached heartbeat — avoids slow SSH pgrep
            # pgrep -fa 'python.*bot' never matches 'python3 -u main.py'
            connected = False
            last_heartbeat = None
            cached_state = _CACHE.get("state") or {}
            last_heartbeat = cached_state.get("last_heartbeat")
            if last_heartbeat:
                try:
                    from datetime import datetime as _dt, timezone as _tz
                    # fromisoformat() doesn't support '+00:00' suffix until Python 3.11
                    hb_clean = last_heartbeat.split('+')[0].split('Z')[0]
                    hb_dt = _dt.fromisoformat(hb_clean).replace(tzinfo=_tz.utc)
                    age_s = (_dt.now(_tz.utc) - hb_dt).total_seconds()
                    connected = age_s < 1200  # alive if heartbeat within last 20 min (scan every 15 min)
                except Exception:
                    pass

            # Parse logs/bot.log + gz archives — covers log rotation
            TGPAT = r"'Telegram|Brief|\[Brief\]|Signal Alert|Morning|Scan @|Signals fired|Sent to|startup alert'"
            LOGDIR = "/home/ubuntu/btc-bot/logs"
            log_raw = _ssh_run(
                f"{{ for f in {LOGDIR}/bot.log.*.gz; do zcat \"$f\" 2>/dev/null; done; "
                f"cat {LOGDIR}/bot.log 2>/dev/null; }} | grep -E {TGPAT} | tail -300"
            )
            messages = []
            if log_raw:
                for line in log_raw.splitlines():
                    line = line.strip()
                    if line:
                        messages.append({"raw": line})
            return self._send_json({
                "connected": connected,
                "bot_username": None,
                "messages": messages,
                "count": len(messages),
                "last_heartbeat": last_heartbeat,
            })
        if path == "/api/coinbase":
            return self._handle_coinbase()
        if path == "/api/trading_mode":
            return self._handle_trading_mode_get()
        if path == "/api/backtest":
            return self._handle_backtest()
        if path == "/api/config":
            return self._handle_config()
        if path == "/api/strategies":
            raw = _ssh_cat("/home/ubuntu/btc-bot/strategy_registry.json")
            if raw:
                try: return self._send_json(json.loads(raw))
                except: pass
            return self._send_json({"err": "registry not available"})
        if path == "/api/briefs":
            raw = _ssh_run("cat /home/ubuntu/btc-bot/logs/briefs.log 2>/dev/null | tail -60")
            briefs = []
            if raw:
                for line in raw.splitlines():
                    line = line.strip()
                    if not line: continue
                    try: briefs.append(json.loads(line))
                    except: pass
            return self._send_json({"briefs": list(reversed(briefs))})
        if path == "/ping":
            body = b"pong"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/health":
            from datetime import datetime as _dt, timezone as _tz
            st = _CACHE.get("state") or {}
            trades = _CACHE.get("trades", [])
            open_pos = any(t.get("open") for t in trades)
            # last_scan_utc — prefer last_daily_scan_day (parsed from log), fallback to heartbeat
            last_scan_raw = st.get("last_daily_scan_day") or st.get("last_heartbeat")
            last_scan_utc = None
            staleness_secs = None
            if last_scan_raw:
                try:
                    clean = last_scan_raw.split('+')[0].split('Z')[0].replace(' ', 'T')
                    dt_scan = _dt.fromisoformat(clean).replace(tzinfo=_tz.utc)
                    staleness_secs = (_dt.now(_tz.utc) - dt_scan).total_seconds()
                    last_scan_utc = dt_scan.strftime("%Y-%m-%dT%H:%M:%SZ")
                except Exception:
                    last_scan_utc = last_scan_raw
            status = "stale" if (staleness_secs is None or staleness_secs > 1800) else "ok"
            # signals_fired_today — count trades with entry today
            today_str = _dt.now(_tz.utc).strftime("%Y-%m-%d")
            signals_today = sum(
                1 for t in trades
                if (t.get("timestamp_entry") or "").startswith(today_str)
            )
            # portfolio_dd_pct — simple peak-to-trough on closed pnl_net_usd
            closed_pnl = [float(t.get("pnl_net_usd") or 0) for t in trades if not t.get("open")]
            dd_pct = 0.0
            if closed_pnl:
                try:
                    acct = float(st.get("account_size") or 10000)
                    equity, peak = acct, acct
                    for p in closed_pnl:
                        equity += p
                        if equity > peak: peak = equity
                    dd_pct = round((peak - equity) / peak * 100, 2) if peak else 0.0
                except Exception:
                    pass
            # ── Brain fields (additive) ───────────────────────────────────────
            brain_active_trade = False
            brain_equity       = 1000.0
            brain_last_scan    = None
            brain_watching     = 0
            brain_confirming   = 0
            try:
                _bst_fp = Path(__file__).parent / 'brain_state.json'
                if _bst_fp.exists():
                    _bst = json.loads(_bst_fp.read_text(encoding='utf-8'))
                    brain_active_trade = bool(_bst.get('active_trade'))
                    brain_equity       = float(_bst.get('equity', 1000))
                    brain_last_scan    = _bst.get('last_updated')
                _blv_fp = Path(__file__).parent / 'brain_levels.json'
                if _blv_fp.exists():
                    _blv = json.loads(_blv_fp.read_text(encoding='utf-8'))
                    for _lv in _blv.get('levels', []):
                        if _lv.get('status') == 'WATCHING':    brain_watching  += 1
                        if _lv.get('status') == 'CONFIRMING':  brain_confirming += 1
                    brain_last_scan = brain_last_scan or _blv.get('last_updated')
            except Exception:
                pass
            return self._send_json({
                "status":                    status,
                "uptime_seconds":            int(time.time() - _START_TIME),
                "last_scan_utc":             last_scan_utc,
                "signals_fired_today":       signals_today,
                "open_position":             open_pos,
                "loss_streak":               st.get("loss_streak", 0),
                "portfolio_dd_pct":          dd_pct,
                "bot_version":               BOT_VERSION,
                "alphabot_active_trade":     open_pos,
                "alphabot_equity":           float(st.get("equity", 0) or 0),
                "alphabrain_active_trade":   brain_active_trade,
                "alphabrain_equity":         brain_equity,
                "brain_last_scan_utc":       brain_last_scan,
                "brain_levels_watching":     brain_watching,
                "brain_levels_confirming":   brain_confirming,
            })
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
        # v9 backtest: live bot configuration + conviction multiplier
        BT_CSV = Path(__file__).parent.parent / "btc-data" / "backtest_v9_trades.csv"
        if not BT_CSV.exists():
            BT_CSV = Path(__file__).parent.parent / "btc-data" / "scheme_i_v8_trades.csv"
        if not BT_CSV.exists():
            return self._send_json({"err": "Backtest file not found"}, 404)

        rows = list(csv.DictReader(open(BT_CSV, encoding="utf-8")))
        # Sort by entry time so equity accumulates correctly
        rows.sort(key=lambda r: r.get("timestamp_entry","") or r.get("t",""))
        START = 10_000.0
        reason_map = {"sl_hit":"sl","tp_hit":"tp","trail_stop":"trail","time_exit":"time"}

        trades = []
        running_eq = START
        for i, r in enumerate(rows):
            # v9 CSV has equity/equity_prev pre-computed (includes conviction multiplier boost).
            # Use those directly; fall back to acct_ret rebuild for older CSV formats.
            acct_ret_col = r.get("acct_ret","")
            eq_col  = r.get("equity") or ""
            eq0_col = r.get("equity_prev") or ""
            if eq_col and eq0_col:
                try: running_eq = round(float(eq_col), 2)
                except: pass
                try: pnl_net = round(float(eq_col) - float(eq0_col), 2)
                except: pnl_net = 0.0
                pnl_gross = pnl_net; fees = 0.0
            else:
                try: pnl_gross = round(float(r.get("pnl_usd") or 0), 2)
                except: pnl_gross = 0.0
                try: fees = round(float(r.get("fees_usd") or 0), 2)
                except: fees = 0.0
                pnl_net = pnl_gross
                notes = r.get("notes","")
                if "equity_after=" in notes:
                    try: running_eq = round(float(notes.split("equity_after=")[1].split(";")[0].split(" ")[0]), 2)
                    except: running_eq = round(running_eq + pnl_net, 2)
                else:
                    running_eq = round(running_eq + pnl_net, 2)
            entry_t = r.get("timestamp_entry","") or r.get("t","") or ""
            exit_t  = r.get("timestamp_exit","") or entry_t
            try: tier = int(float(r.get("tier", 1) or 1))
            except: tier = 1
            _rm = r.get("r_multiple","")
            try: r_mult = round(float(_rm), 3) if _rm not in ("","nan","None",None) else None
            except: r_mult = None
            try: bars = int(float(r.get("bars_held") or 0))
            except: bars = 0
            try: entry_p = float(r.get("entry_price") or 0)
            except: entry_p = 0.0
            try: exit_p = float(r.get("exit_price") or 0)
            except: exit_p = 0.0
            trades.append({
                "trade_id":        r.get("trade_id") or f"BT-{i+1:04d}",
                "timestamp_entry": entry_t,
                "timestamp_exit":  exit_t,
                "direction":       ("long" if str(r.get("direction","1")) in ("1","long") else "short"),
                "setup_type":      r.get("setup_type","") or r.get("strat",""),
                "tier":            tier,
                "grade":           r.get("grade") or None,
                "entry_price":     entry_p,
                "exit_price":      exit_p,
                "exit_reason":     reason_map.get(r.get("exit_reason",""), r.get("exit_reason","")),
                "r_multiple":      r_mult,
                "bars_held":       bars,
                "pnl_net_usd":     pnl_net,
                "pnl_usd":         pnl_gross,
                "fees_usd":        fees,
                "balance_after":   running_eq,
                "open":            False,
                # Pass-through SL/TP/risk fields from CSV so frontend can display them
                "sl_price":        float(r["sl_price"])  if r.get("sl_price")  not in ("","None",None) else None,
                "tp_price":        float(r["tp_price"])  if r.get("tp_price")  not in ("","None",None) else None,
                "sl_distance_pct": float(r["sl_pct"]) * 100 if r.get("sl_pct") not in ("","None",None) else None,
                "rr_target":       float(r["r_multiple"]) if r_mult is not None and r_mult > 0 else None,
            })

        # Only count trades with real r_multiple for stats (skip T4/weight-0 rows)
        scored  = [t for t in trades if t["r_multiple"] is not None]
        wins    = [t for t in scored if t["r_multiple"] >= 0]
        losses  = [t for t in scored if t["r_multiple"] < 0]
        total_r = round(sum(t["r_multiple"] for t in scored), 2)
        avg_r   = round(total_r / len(scored), 3) if scored else 0
        win_rate = round(len(wins) / len(scored) * 100) if scored else 0
        final_eq = running_eq

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
        for t in scored:
            try:
                h = (int(t["timestamp_entry"][11:13]) // 4) * 4
                key = f"{h:02d}:00"
                if t["r_multiple"] >= 0: hrly[key]["wins"] += 1
                else:                    hrly[key]["losses"] += 1
            except: pass
        hourly_stats = [{"hour": k, "label": k, **v} for k, v in sorted(hrly.items())]

        days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
        dow = defaultdict(lambda: {"wins": 0, "losses": 0, "r": 0.0})
        for t in scored:
            try:
                d = _dt.datetime.strptime(t["timestamp_entry"][:10], "%Y-%m-%d").weekday()
                dow[days[d]]["wins"]   += t["r_multiple"] >= 0
                dow[days[d]]["losses"] += t["r_multiple"] < 0
                dow[days[d]]["r"]      += t["r_multiple"]
            except: pass
        dow_stats = [{"day": d, "wins": dow[d]["wins"], "losses": dow[d]["losses"],
                      "total_r": round(dow[d]["r"], 2)} for d in days]

        sm = defaultdict(lambda: {"wins": 0, "losses": 0, "wr": 0.0, "lr": 0.0})
        for t in scored:
            s = t["setup_type"]
            if t["r_multiple"] >= 0: sm[s]["wins"] += 1; sm[s]["wr"] += t["r_multiple"]
            else:                    sm[s]["losses"] += 1; sm[s]["lr"] += abs(t["r_multiple"])
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
        for t in scored:
            s = t["setup_type"]
            if s not in setup_stats: setup_stats[s] = {"w": 0, "l": 0}
            if t["r_multiple"] >= 0: setup_stats[s]["w"] += 1
            else:                    setup_stats[s]["l"] += 1

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
                             "closed_trades": len(scored),
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
            "config":       {"TIER_RISK_PCT":{1:4.0,2:3.0,3:1.5},"TIER_RR":{1:3.0,2:2.5,3:2.0},"DD_FILTER_PCT":-10,"RUN_INTERVAL_MINUTES":15},
            "date_range":   {"start": rows[0].get("timestamp_entry", rows[0].get("t",""))[:10] if rows else "",
                             "end":   rows[-1].get("timestamp_entry", rows[-1].get("t",""))[:10] if rows else ""},
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

    def _handle_config(self):
        """Return live config values from signal_engine/config.py."""
        try:
            import sys as _sys, importlib as _il
            _bot_dir = str(Path(__file__).parent)
            if _bot_dir not in _sys.path:
                _sys.path.insert(0, _bot_dir)
            from signal_engine import config as _cfg
            _il.reload(_cfg)
            return self._send_json({
                "TIER_RISK_PCT":       {str(k): v for k, v in _cfg.TIER_RISK_PCT.items()},
                "TIER_RR":             {str(k): v for k, v in _cfg.TIER_RR.items()},
                "HARD_CAP_PCT":        _cfg.HARD_CAP_PCT,
                "DD_FILTER_PCT":       _cfg.DD_FILTER_PCT,
                "ACCOUNT_SIZE":        _cfg.ACCOUNT_SIZE,
                "EMA_FAST":            _cfg.EMA_FAST,
                "EMA_SLOW":            _cfg.EMA_SLOW,
                "ATR_LEN":             _cfg.ATR_LEN,
                "RSI_LEN":             _cfg.RSI_LEN,
                "RUN_INTERVAL_MINUTES":_cfg.RUN_INTERVAL_MINUTES,
                "MORNING_BRIEF_LOCAL": _cfg.MORNING_BRIEF_LOCAL,
            })
        except Exception as e:
            return self._send_json({"err": str(e)}, 500)

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
        a0 = str(args[0]) if args else ""
        a1 = str(args[1]) if len(args) > 1 else ""
        # In quiet mode: suppress all 200/304; always show errors
        is_ok = a1 in ("200", "304")
        if _QUIET and is_ok:
            return
        # In normal mode: already filter static-asset 200s, show API + errors
        if not _QUIET and is_ok and "/api/" not in a0 and "/health" not in a0 and "/ping" not in a0:
            return
        try:
            if sys.stderr:
                sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        except Exception:
            pass


import os
os.chdir(ROOT)
class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

def _background_refresh():
    """Poll Oracle every CACHE_TTL seconds in a daemon thread."""
    while True:
        try:
            _refresh_cache()
        except Exception:
            pass
        time.sleep(CACHE_TTL)

with ThreadedServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"AlphaBot v{BOT_VERSION} dashboard -> http://localhost:{PORT}")
    print(f"  Oracle bot: {ORACLE_HOST}")
    if _QUIET:
        print(f"  Quiet mode: 200/304 logs suppressed (errors still shown)")
    _threading.Thread(target=_background_refresh, daemon=True).start()
    print(f"  Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
