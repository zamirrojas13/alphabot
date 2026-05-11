"""What did the DD-15% filter pause? Tier-3 trades skipped when port DD <= -15%."""
import sys
from pathlib import Path
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "btc-data"))

from portfolio_compare import PORT_NEW
import pandas as pd

START = 1000.0
RISK = 0.05
p = PORT_NEW.copy().sort_values("t").reset_index(drop=True)
eq = START; peak = START
paused = []
for _, r in p.iterrows():
    cur_dd = (eq/peak - 1)*100
    if cur_dd <= -15 and r["tier"] == 3:
        paused.append({"t": r["t"], "strat": r["strat"], "pnl_pct": r["pnl"],
                        "tier": r["tier"], "dd_at_time": round(cur_dd,1), "eq_at_time": round(eq,2)})
        continue
    acct = (r["pnl"]/r["sl_pct"]) * RISK * float(r["w"])
    acct = max(min(acct, 0.30), -0.10)
    eq = eq * (1 + acct); peak = max(peak, eq)

df = pd.DataFrame(paused)
df["year"] = pd.to_datetime(df["t"]).dt.year
df["win"] = df["pnl_pct"] > 0

print(f"DD-filter pauses: {len(df)}")
print(f"  Winners paused: {df['win'].sum()}")
print(f"  Losers paused:  {(~df['win']).sum()}")

print("\nBy YEAR:")
yr = df.groupby("year").agg(n=("win","size"), wins=("win","sum"),
                              losses=("win", lambda x: (~x).sum()),
                              avg_pnl_pct=("pnl_pct", lambda x: round(x.mean()*100,2))).reset_index()
print(yr.to_string(index=False))

print("\nWINNERS that got paused (would-have-been gains we missed):")
w = df[df["win"]].sort_values("pnl_pct", ascending=False)
print(w[["t","strat","pnl_pct","dd_at_time","eq_at_time"]].to_string(index=False))

print("\nLOSERS that got paused (gains the filter saved):")
l = df[~df["win"]].sort_values("pnl_pct").head(10)
print(l[["t","strat","pnl_pct","dd_at_time","eq_at_time"]].to_string(index=False))

# Net effect
net_pct = df["pnl_pct"].sum()*100
print(f"\nNet pnl_pct of all paused trades: {net_pct:+.1f}%")
print(f"  (sum of % moves; positive = filter cost us money, negative = filter saved us)")
