# AlphaBot — local dashboard for our 11-strat BTC bot

## Run

```
python alphabot/serve.py
```

Open http://localhost:8765

## Files

- `serve.py` — zero-dependency static server (port 8765)
- `server.py` — FastAPI version with REST hooks (use later, requires `pip install fastapi uvicorn`)
- `generate_data.py` — regenerates `static/data.js` from real backtest trades
- `static/index.html` — dashboard shell (React via CDN, no build step needed)
- `static/data.js` — current data snapshot (auto-generated)
- `static/components/*.jsx` — 11 page components (Sidebar + 10 pages)

## Schema deviations from Claude Design handoff

Adapted to our strategy. Documented so we don't lose them:

- **Tier risk**: T1=2.5%, T2=5%, T3=7.5% of equity (scaled to $1K = $25/$50/$75)
- **Setup types**: 11 named strats (T1a–T3c) instead of `oops/sweep/pattern`
- **Grading removed**: Tier (T1/T2/T3) is the only badge. "Grade Distribution" widget renamed to "Tier Distribution".
- **Indicators**: only RSI(14), EMA50, EMA200, ATR(14), vol_ratio. Chandelier and Williams %R removed.
- **Time exits**: per-TF — weekly=12 bars, daily=25 bars, H4=40, H1=30
- **Risk control**: portfolio DD <= -15% pauses tier-3 (replaces `loss_streak >= 3` rule)
- **Broker**: paper-mode mock; `coinbase_cfm_v1` adapter slot reserved for live wiring

## Refresh data

After backtest changes:
```
python alphabot/generate_data.py
```

## Wire to real broker (later)

When ready, switch from `serve.py` to `server.py`, install FastAPI, fill the
`/api/account`, `/api/state`, `/api/telegram` endpoints, and point the front-end
fetches to those. The component contracts (data.js shape) stay the same.
