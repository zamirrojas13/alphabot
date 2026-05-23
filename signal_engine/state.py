# ═══════════════════════════════════════════════════════════════════
# State persistence — single state.json shared with the dashboard.
# ═══════════════════════════════════════════════════════════════════
import json
from datetime import datetime, timezone
from . import config


_DEFAULTS = {
    "loss_streak": 0,
    "tier_restricted": False,
    "portfolio_dd_pct": 0.0,
    "tier3_paused": False,
    "last_signal_bar": None,
    "last_daily_scan_day": None,
    "last_morning_brief": None,
    "trade_pending": False,
    "active_trade": None,
    "alerted_bars": [],   # de-dupe: avoid re-alerting same bar
    "last_trade_result": None,  # "win" | "loss" — conviction multiplier Test B
}


def get() -> dict:
    if not config.STATE_FILE.exists():
        return dict(_DEFAULTS)
    try:
        with open(config.STATE_FILE) as f:
            data = json.load(f)
        for k, v in _DEFAULTS.items():
            data.setdefault(k, v)
        return data
    except Exception as e:
        print(f"[state] read error: {e} — using defaults")
        return dict(_DEFAULTS)


def save(data: dict) -> None:
    import shutil
    backup = config.STATE_FILE.with_suffix(".backup.json")
    if config.STATE_FILE.exists():
        shutil.copy2(config.STATE_FILE, backup)
    config.STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(config.STATE_FILE, "w") as f:
        json.dump(data, f, indent=2, default=str)


def already_alerted_bar(bar_key: str) -> bool:
    s = get()
    return bar_key in s.get("alerted_bars", [])


def mark_alerted(bar_key: str) -> None:
    s = get()
    arr = s.get("alerted_bars", [])
    arr.append(bar_key)
    s["alerted_bars"] = arr[-200:]   # keep last 200
    s["last_signal_bar"] = bar_key
    save(s)


def already_briefed_today(day: str) -> bool:
    return get().get("last_morning_brief") == day


def mark_briefed(day: str) -> None:
    s = get()
    s["last_morning_brief"] = day
    save(s)


def set_active_trade(trade: dict | None) -> None:
    s = get()
    s["active_trade"] = trade
    s["trade_pending"] = trade is not None
    save(s)


def update_last_trade_result(won: bool) -> None:
    s = get()
    s["last_trade_result"] = "win" if won else "loss"
    save(s)


def update_dd(dd_pct: float) -> None:
    s = get()
    s["portfolio_dd_pct"] = float(dd_pct)
    s["tier3_paused"] = dd_pct <= config.DD_FILTER_PCT
    save(s)


def get_strategy_registry() -> dict:
    """Return strategy metadata for dashboard consumption."""
    from . import config
    return {
        sid: {
            'tier': info['tier'],
            'tf': info['tf'],
            'side': info['side'],
            'sl': info['sl'],
            'rr': info['rr'],
            'name': info['name'],
            'desc': info['desc'],
        }
        for sid, info in config.STRATEGIES.items()
    }
