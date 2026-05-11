"""What did we skip with the 10% hard cap? Which years, which strats, win or loss?"""
import sys
from pathlib import Path
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "btc-data"))

from portfolio_compare import PORT_NEW
import pandas as pd

START = 1000.0
TIER_RISK_PCT = {1: 2.5, 2: 5.0, 3: 7.5}
HARD_CAP = 0.10
NANO = 0.01
ENTRY = 50000  # placeholder

p = PORT_NEW.copy().sort_values("t").reset_index(drop=True)
eq = START; peak = START
taken = []; skipped = []
for _, r in p.iterrows():
    cur_dd = (eq/peak - 1)*100
    if cur_dd <= -15 and r["tier"] == 3:
        continue  # DD-filter pause; not a sizing skip
    sl_pct = float(r["sl_pct"])
    risk_per_contract = ENTRY * NANO * sl_pct
    cap_dollar = eq * HARD_CAP
    target = eq * (TIER_RISK_PCT[r["tier"]]/100)
    contracts_target = target/risk_per_contract if risk_per_contract>0 else 0
    nano = max(0, int(contracts_target))
    if nano == 0 and risk_per_contract <= cap_dollar:
        nano = 1
    max_by_cap = int(cap_dollar/risk_per_contract) if risk_per_contract>0 else 0
    if nano > max_by_cap:
        nano = max_by_cap
    if nano == 0:
        skipped.append({"t": r["t"], "strat": r["strat"], "tier": r["tier"],
                         "pnl_pct": r["pnl"], "sl_pct": sl_pct, "eq_at_time": round(eq,2)})
        continue
    qty = nano * NANO
    pnl_usd = qty * ENTRY * float(r["pnl"])
    eq = eq + pnl_usd
    peak = max(peak, eq)
    taken.append({"t": r["t"], "strat": r["strat"], "pnl_pct": r["pnl"]})

skipped_df = pd.DataFrame(skipped)
if len(skipped_df):
    skipped_df["year"] = pd.to_datetime(skipped_df["t"]).dt.year
    skipped_df["win"] = skipped_df["pnl_pct"] > 0

print("="*80)
print(f"SKIPPED TRADES (couldn't fit in 10% cap): {len(skipped_df)}")
print("="*80)
print("\nBy YEAR:")
yr = skipped_df.groupby("year").agg(
    n=("win","size"),
    wins=("win","sum"),
    losses=("win", lambda x: (~x).sum()),
    avg_pnl_pct=("pnl_pct", lambda x: round(x.mean()*100, 2)),
).reset_index()
print(yr.to_string(index=False))

print("\nBy STRAT:")
strat = skipped_df.groupby("strat").agg(
    n=("win","size"),
    wins=("win","sum"),
    win_rate=("win", lambda x: f"{x.mean()*100:.0f}%"),
    avg_pnl_pct=("pnl_pct", lambda x: round(x.mean()*100, 2)),
).sort_values("n", ascending=False)
print(strat.to_string())

# Lost equity if we'd taken them all
print("\nWINNERS LOST (would have been wins if we had bigger account):")
lost_winners = skipped_df[skipped_df["win"]].sort_values("pnl_pct", ascending=False)
print(lost_winners[["t","strat","pnl_pct","eq_at_time"]].head(15).to_string(index=False))

print(f"\nTotal winners skipped: {(skipped_df['win']).sum()}")
print(f"Total losers skipped: {(~skipped_df['win']).sum()}")
print(f"Net pnl_pct missed (sum): {(skipped_df['pnl_pct'].sum())*100:.1f}%")
print(f"  (this is uncompounded sum; actual missed equity gain depends on account size at each trade)")
