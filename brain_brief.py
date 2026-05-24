#!/usr/bin/env python3
"""
AlphaBrain weekly level map brief — send once manually to verify format.
Run from /home/ubuntu/btc-bot with env loaded:
  set -a; source .env; set +a; python3 brain_brief.py
"""
import json
from pathlib import Path
from datetime import datetime, timezone

BRAIN_DIR = Path(__file__).parent

LEVEL_NAMES = {
    'prev_week_high':    "Last week's high",
    'prev_week_low':     "Last week's low",
    'prev_month_high':   "Last month's high",
    'prev_month_low':    "Last month's low",
    'prev_quarter_high': "Last quarter's high",
    'prev_quarter_low':  "Last quarter's low",
    'prev_year_high':    "Last year's high",
    'prev_year_low':     "This year's low",
    'all_time_high':     "All time high",
    'cycle_low':         "Cycle low (4yr)",
}
STRENGTH_LABELS = {'HIGH': 'Strong level', 'MEDIUM': 'Moderate level', 'LOW': 'Weak level'}

def level_name(t):
    return LEVEL_NAMES.get(t, t.replace('_', ' '))

def strength_label(s):
    return STRENGTH_LABELS.get(s, s)


def send_brief():
    from signal_engine import config
    from signal_engine.telegram_alerts import send_message
    from signal_engine.data_fetcher import fetch_h1

    # Load levels
    levels_fp = BRAIN_DIR / 'brain_levels.json'
    if not levels_fp.exists():
        print("brain_levels.json not found")
        return
    data = json.loads(levels_fp.read_text())
    levels = data.get('levels', [])

    # Load brain state
    state_fp = BRAIN_DIR / 'brain_state.json'
    brain_st = json.loads(state_fp.read_text()) if state_fp.exists() else {}

    # Get current price
    try:
        df = fetch_h1(n_bars=2)
        current_price = float(df['close'].iloc[-1])
    except Exception:
        current_price = None

    # Active levels
    active = [l for l in levels if l['status'] in ('WATCHING', 'CONFIRMING')]
    resistance = sorted([l for l in active if l['direction'] == 'RESISTANCE'], key=lambda x: x['price'])
    support    = sorted([l for l in active if l['direction'] == 'SUPPORT'],    key=lambda x: x['price'], reverse=True)

    # Macro context from state
    macro = brain_st.get('macro', {})
    macro_trend = macro.get('macro_trend', 'Unknown')
    macro_label = macro_trend.replace('_', ' ').title() if macro_trend else 'Unknown'

    active_trade = brain_st.get('active_trade')
    brain_equity = brain_st.get('equity', 1000)

    lines = [
        "🧠 LEVEL STRATEGY",
        "━━━━━━━━━━━━━━━━",
        "WEEKLY LEVEL MAP",
        "━━━━━━━━━━━━━━━━",
        f"Market mood: {macro_label}",
        "",
    ]

    if resistance:
        lines.append("RESISTANCE ABOVE (selling zones):")
        for lvl in resistance:
            dist = f"  ({(lvl['price'] - current_price) / current_price * 100:+.1f}%)" if current_price else ""
            status_note = " ⚡ confirming" if lvl['status'] == 'CONFIRMING' else ""
            lines.append(f"🔴 {level_name(lvl['type'])}: ${lvl['price']:,.0f} — {strength_label(lvl['strength'])}{dist}{status_note}")

    if resistance and support:
        lines.append("")

    if support:
        lines.append("SUPPORT BELOW (buying zones):")
        for lvl in support:
            dist = f"  ({(lvl['price'] - current_price) / current_price * 100:+.1f}%)" if current_price else ""
            status_note = " ⚡ confirming" if lvl['status'] == 'CONFIRMING' else ""
            lines.append(f"🟢 {level_name(lvl['type'])}: ${lvl['price']:,.0f} — {strength_label(lvl['strength'])}{dist}{status_note}")

    lines.append("")
    trade_line = "Active brain trade open" if active_trade else "No active brain trade"
    lines.append(f"Watching {len(active)} levels. {trade_line}.")
    lines.append(f"Brain account: ${brain_equity:,.2f} (paper)")
    if current_price:
        lines.append(f"BTC: ${current_price:,.0f}")
    lines.append("Next update: Sunday evening")

    msg = "\n".join(lines)
    print("--- Sending ---")
    print(msg)
    print("---")
    ok = send_message(msg)
    print("Sent:", ok)


if __name__ == "__main__":
    send_brief()
