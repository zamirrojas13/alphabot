"""
AlphaBrain v1 — Fibonacci Target Calculator
Simple two-function module: range-based targets + OTE zone.
"""


def calculate_targets(level_price, direction, reference_range):
    """
    Calculate price targets from a reacted key level.

    Parameters
    ----------
    level_price      : float  — the key level price that was reacted to
    direction        : str    — 'LONG' or 'SHORT'
    reference_range  : float  — prior week high-low range (absolute $)

    Returns
    -------
    dict with goal_1, goal_2, goal_3, reference_range, reference_range_pct
    """
    direction = direction.upper()
    if direction not in ('LONG', 'SHORT'):
        raise ValueError(f"direction must be 'LONG' or 'SHORT', got {direction!r}")

    r = reference_range

    if direction == 'LONG':
        g1 = level_price + r * 0.5
        g2 = level_price + r * 1.0
        g3 = level_price + r * 1.5
    else:  # SHORT
        g1 = level_price - r * 0.5
        g2 = level_price - r * 1.0
        g3 = level_price - r * 1.5

    ref_pct = (r / level_price) * 100 if level_price else 0.0

    return {
        'goal_1': round(g1, 2),
        'goal_2': round(g2, 2),
        'goal_3': round(g3, 2),
        'reference_range': round(r, 2),
        'reference_range_pct': round(ref_pct, 2),
    }


def calculate_ote_zone(swing_low, swing_high, direction):
    """
    Optimal Trade Entry zone — 62-79% retracement of the swing that
    brought price to the reacted level.

    For LONG : after price wicks down to support, the OTE is the 62-79%
               retracement of the move from swing_low up to level
               (entry on the pullback into the reaction zone).
    For SHORT: after price wicks up to resistance, the OTE is the 62-79%
               retracement of the move from swing_high down to level.

    Parameters
    ----------
    swing_low  : float — low of the move leading into the level
    swing_high : float — high of the move leading into the level
    direction  : str   — 'LONG' or 'SHORT'

    Returns
    -------
    dict with ote_low (62% retrace) and ote_high (79% retrace)
    """
    direction = direction.upper()
    span = swing_high - swing_low  # always positive

    if direction == 'LONG':
        # Retracement of the up-move: measure from swing_high downward
        # 62% retrace = swing_high - 0.62 × span
        # 79% retrace = swing_high - 0.79 × span
        ote_high = swing_high - 0.62 * span   # shallower retrace → higher price
        ote_low  = swing_high - 0.79 * span   # deeper retrace → lower price
    else:  # SHORT
        # Retracement of the down-move: measure from swing_low upward
        # 62% retrace = swing_low + 0.62 × span
        # 79% retrace = swing_low + 0.79 × span
        ote_low  = swing_low + 0.62 * span   # shallower retrace → lower price
        ote_high = swing_low + 0.79 * span   # deeper retrace → higher price

    return {
        'ote_low':  round(ote_low, 2),
        'ote_high': round(ote_high, 2),
    }
