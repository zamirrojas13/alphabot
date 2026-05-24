"""
AlphaBrain v4 — Position Sizing
Coinbase Nano Futures aware. Matches AlphaBot contract conventions.
"""
import math

BASE_RISK_PCT  = 0.025    # 2.5% of brain equity per trade
HARD_CAP_PCT   = 0.05     # 5% max exposure regardless of conviction
MAX_CONTRACTS  = 2        # Coinbase hard limit
CONTRACT_BTC   = 0.01     # 1 Nano contract = 0.01 BTC

# (level_strength, macro_aligned) -> multiplier
CONVICTION = {
    ('HIGH',   True):  1.3,
    ('HIGH',   False): 1.0,
    ('MEDIUM', True):  0.8,
    ('MEDIUM', False): 0.8,
    ('LOW',    True):  0.6,
    ('LOW',    False): 0.6,
}


def get_macro_size_multiplier(signal_direction, macro_context):
    """
    Light macro size modifier. Does NOT block signals.
    signal_direction : 'LONG' or 'SHORT'
    macro_context    : dict with 'yearly_bias' key ('BULL', 'BEAR', 'NEUTRAL')
    Returns float multiplier: 1.0 (aligned), 0.85 (neutral), 0.65 (counter-trend).
    """
    bias = macro_context.get('yearly_bias', 'NEUTRAL')
    aligned = (signal_direction == 'LONG' and bias == 'BULL') or \
              (signal_direction == 'SHORT' and bias == 'BEAR')
    counter = (signal_direction == 'LONG' and bias == 'BEAR') or \
              (signal_direction == 'SHORT' and bias == 'BULL')
    if aligned:
        return 1.0
    if counter:
        print(f"BRAIN SIZING: counter-trend signal ({signal_direction} vs {bias} macro) -- 0.65x size")
        return 0.65
    return 0.85   # NEUTRAL


def calculate_brain_size(entry, sl, btc_price, brain_equity,
                          level_strength='LOW', macro_aligned=True,
                          is_weekend=False, macro_size_mult=1.0):
    """
    Returns (contracts: int, risk_info: dict).

    Sizing formula:
      sl_dist_pct       = |entry - sl| / entry
      conviction        = CONVICTION[(strength, aligned)]
      risk_amount       = brain_equity * BASE_RISK_PCT * conviction
      contract_value    = btc_price * CONTRACT_BTC
      risk_per_contract = contract_value * sl_dist_pct
      contracts         = floor(risk_amount / risk_per_contract)

    Caps applied in order:
      1. MAX_CONTRACTS (2)
      2. Weekend cap (1)
      3. Hard cap (5% of equity)
    """
    sl_dist = abs(entry - sl) / entry if entry > 0 else 0
    if sl_dist <= 0:
        return 0, {}

    conviction      = CONVICTION.get((level_strength, macro_aligned), 0.6)
    risk_amount     = brain_equity * BASE_RISK_PCT * conviction * macro_size_mult
    contract_value  = btc_price * CONTRACT_BTC
    risk_per_ct     = contract_value * sl_dist
    if risk_per_ct <= 0:
        return 0, {}

    contracts = math.floor(risk_amount / risk_per_ct)
    contracts = min(contracts, MAX_CONTRACTS)
    if is_weekend:
        contracts = min(contracts, 1)
    hard_cap_cts = math.floor((brain_equity * HARD_CAP_PCT) / contract_value)
    contracts = max(0, min(contracts, hard_cap_cts))

    actual_risk = (contracts * contract_value * sl_dist) / brain_equity * 100

    return contracts, {
        'sl_dist_pct':    round(sl_dist * 100, 3),
        'conviction':     conviction,
        'risk_amount':    round(risk_amount, 2),
        'actual_risk_pct': round(actual_risk, 3),
        'contract_value': round(contract_value, 2),
    }
