/*
  AlphaBrain v4 — Level Map Dashboard
  Completely isolated from AlphaBot data. Reads /api/brain/levels, /api/brain/state, /api/ticker.
  DO NOT import or mix with AlphaBot trade data.
*/

const BRAIN_ACCENT  = '#a78bfa';   // purple — distinct from AlphaBot orange
const BRAIN_BULL    = '#00d084';
const BRAIN_BEAR    = '#ff4d6d';
const BRAIN_NEUTRAL = '#F7931A';

function Brain() {
  const [levels, setLevels]           = React.useState([]);
  const [brainState, setBrainState]   = React.useState(null);
  const [currentPrice, setCurrentPrice] = React.useState(null);
  const [lastUpdated, setLastUpdated] = React.useState(null);
  const [loading, setLoading]         = React.useState(true);
  const [err, setErr]                 = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const [levRes, stRes, tickRes] = await Promise.all([
        fetch('/api/brain/levels').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/brain/state').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/ticker').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (levRes?.levels !== undefined) {
        setLevels(levRes.levels || []);
        setLastUpdated(levRes.last_updated);
        setErr(null);
      } else {
        setErr('brain_levels.json not found — run initialize_levels first');
      }
      if (stRes && !stRes.err) setBrainState(stRes);
      if (tickRes?.price) setCurrentPrice(parseFloat(tickRes.price));
    } catch (e) {
      setErr(String(e));
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const active       = levels.filter(l => l.status === 'WATCHING' || l.status === 'CONFIRMING');
  const confirming   = active.filter(l => l.status === 'CONFIRMING');
  const resistance   = active.filter(l => l.direction === 'RESISTANCE').sort((a, b) => a.price - b.price);
  const support      = active.filter(l => l.direction === 'SUPPORT').sort((a, b) => b.price - a.price);
  const denied       = levels.filter(l => l.status === 'DENIED').length;

  const distPct = (p) => currentPrice ? ((p - currentPrice) / currentPrice * 100) : null;

  const strengthColor = s => s === 'HIGH' ? BRAIN_BULL : s === 'MEDIUM' ? BRAIN_NEUTRAL : '#5a5a6e';

  // ── Macro context from brain_state (if available) ──────────────────────────
  const macro = brainState?.macro || null;

  if (loading) return (
    <div style={bs.page}>
      <div style={{color:'#5a5a6e', padding:40, fontFamily:"'Space Grotesk',sans-serif"}}>Loading Brain levels…</div>
    </div>
  );

  return (
    <div style={bs.page}>
      {/* Header */}
      <div style={bs.header}>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <span style={{fontSize:22, color:BRAIN_ACCENT}}>◆</span>
          <div>
            <div style={bs.title}>AlphaBrain v4</div>
            <div style={bs.subtitle}>Institutional Level Reaction System · Paper Trading</div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          {currentPrice && (
            <div style={{fontSize:22, fontWeight:700, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace"}}>
              ${currentPrice.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}
            </div>
          )}
          <div style={{fontSize:10, color:'#3e3e52', marginTop:2}}>
            Updated {lastUpdated ? lastUpdated.slice(0,16).replace('T',' ') + ' UTC' : '—'}
          </div>
        </div>
      </div>

      {err && (
        <div style={{margin:'0 24px 16px', padding:'12px 16px', background:'rgba(255,77,109,0.08)',
                     border:'1px solid rgba(255,77,109,0.25)', borderRadius:8,
                     color:'#ff4d6d', fontSize:12, fontFamily:"'Space Grotesk',sans-serif"}}>
          ⚠ {err}
        </div>
      )}

      {/* Stats row */}
      <div style={bs.statsRow}>
        {[
          { label:'Active Levels', val: active.length, sub:'WATCHING' },
          { label:'Confirming',    val: confirming.length, sub:'within 0.8%', color: confirming.length > 0 ? BRAIN_ACCENT : undefined },
          { label:'Denied',        val: denied,       sub:'broken through' },
          { label:'Brain Equity',  val: brainState ? `$${(brainState.equity || 1000).toLocaleString()}` : '$1,000', sub:'paper mode' },
          { label:'Trades',        val: brainState?.trade_count ?? 0, sub:'all-time' },
        ].map(({label, val, sub, color}) => (
          <div key={label} style={bs.statCard}>
            <div style={{fontSize:11, color:'#3e3e52', letterSpacing:'0.4px', textTransform:'uppercase', marginBottom:4}}>{label}</div>
            <div style={{fontSize:22, fontWeight:700, color: color || '#ece9e2', fontFamily:"'JetBrains Mono',monospace"}}>{val}</div>
            <div style={{fontSize:10, color:'#3e3e52', marginTop:2}}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Active trade banner (if any) */}
      {brainState?.active_trade && (
        <div style={{margin:'0 24px 16px', padding:'14px 20px',
                     background:'rgba(167,139,250,0.08)', border:'1px solid rgba(167,139,250,0.25)',
                     borderRadius:10, display:'flex', alignItems:'center', gap:20}}>
          <span style={{fontSize:14, color:BRAIN_ACCENT, fontWeight:700}}>◆ ACTIVE BRAIN TRADE</span>
          <span style={{fontSize:12, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace"}}>
            {brainState.active_trade.direction?.toUpperCase()} · Entry ${brainState.active_trade.entry}
          </span>
          <span style={{fontSize:12, color:'#5a5a6e'}}>
            SL ${brainState.active_trade.sl} · Level {brainState.active_trade.level_id}
          </span>
        </div>
      )}

      {/* Confirming alert */}
      {confirming.length > 0 && (
        <div style={{margin:'0 24px 16px', padding:'12px 20px',
                     background:'rgba(167,139,250,0.15)', border:'1px solid rgba(167,139,250,0.5)',
                     borderRadius:10, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
          <span style={{fontSize:13, fontWeight:700, color:BRAIN_ACCENT}}>⚡ CONFIRMING</span>
          {confirming.map(l => (
            <span key={l.id} style={{fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2',
                                     background:'rgba(167,139,250,0.15)', padding:'3px 10px',
                                     borderRadius:4, border:'1px solid rgba(167,139,250,0.3)'}}>
              {l.id} · ${l.price.toLocaleString()} · {l.direction}
            </span>
          ))}
        </div>
      )}

      {/* Level Map */}
      <div style={bs.mapRow}>
        {/* RESISTANCE */}
        <LevelColumn
          title="RESISTANCE" color={BRAIN_BEAR} levels={resistance}
          currentPrice={currentPrice} distPct={distPct} strengthColor={strengthColor}
        />
        {/* Price marker */}
        {currentPrice && (
          <div style={bs.pricePin}>
            <div style={bs.pricePinLine}></div>
            <div style={bs.pricePinLabel}>
              ${currentPrice.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}
              <span style={{fontSize:9, color:'#5a5a6e', marginLeft:6}}>CURRENT</span>
            </div>
            <div style={bs.pricePinLine}></div>
          </div>
        )}
        {/* SUPPORT */}
        <LevelColumn
          title="SUPPORT" color={BRAIN_BULL} levels={support}
          currentPrice={currentPrice} distPct={distPct} strengthColor={strengthColor}
        />
      </div>

      {/* Backtest baseline reference */}
      <div style={bs.baseline}>
        <span style={{fontSize:11, color:'#3e3e52', letterSpacing:'0.4px', textTransform:'uppercase', marginRight:16}}>v4 Backtest Baseline</span>
        {[
          ['CAGR', '+9.6%'], ['WR', '21.7%'], ['Avg R', '+0.50'], ['Trades/yr', '8.7'], ['MaxDD', '-25.1%'],
        ].map(([k, v]) => (
          <span key={k} style={{fontSize:11, color:'#5a5a6e', marginRight:16}}>
            <span style={{color:'#3e3e52'}}>{k} </span>
            <span style={{color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace"}}>{v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LevelColumn({ title, color, levels, currentPrice, distPct, strengthColor }) {
  return (
    <div style={{flex:1, minWidth:0}}>
      <div style={{fontSize:11, fontWeight:700, color, letterSpacing:'1px',
                   textTransform:'uppercase', marginBottom:10, paddingBottom:6,
                   borderBottom:`1px solid ${color}22`}}>
        {title} ({levels.length})
      </div>
      {levels.length === 0 && (
        <div style={{fontSize:12, color:'#3e3e52', padding:'12px 0'}}>No active levels</div>
      )}
      {levels.map(lvl => {
        const d = distPct(lvl.price);
        const isConfirming = lvl.status === 'CONFIRMING';
        return (
          <div key={lvl.id} style={{
            padding:'10px 12px', marginBottom:4, borderRadius:7,
            background: isConfirming ? 'rgba(167,139,250,0.12)' : '#111116',
            border: isConfirming ? '1px solid rgba(167,139,250,0.4)' : '1px solid #1f1f28',
            display:'flex', alignItems:'center', gap:10,
            animation: isConfirming ? 'brainPulse 2s ease-in-out infinite' : 'none',
          }}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:2}}>
                <span style={{fontSize:11, fontFamily:"'JetBrains Mono',monospace",
                               color: isConfirming ? '#a78bfa' : '#ece9e2', fontWeight:600}}>
                  ${lvl.price.toLocaleString('en-US', {minimumFractionDigits:0})}
                </span>
                {isConfirming && <span style={{fontSize:9, color:'#a78bfa', fontWeight:700,
                                               background:'rgba(167,139,250,0.15)', padding:'1px 6px',
                                               borderRadius:3}}>CONFIRMING</span>}
              </div>
              <div style={{fontSize:10, color:'#3e3e52'}}>{lvl.type.replace(/_/g,' ')}</div>
            </div>
            <div style={{textAlign:'right', flexShrink:0}}>
              {d !== null && (
                <div style={{fontSize:11, fontWeight:600, fontFamily:"'JetBrains Mono',monospace",
                              color: Math.abs(d) <= 2 ? '#F7931A' : '#5a5a6e'}}>
                  {d >= 0 ? '+' : ''}{d.toFixed(1)}%
                </div>
              )}
              <div style={{fontSize:10, color: strengthColor(lvl.strength), marginTop:2}}>
                {lvl.strength}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const bs = {
  page: {
    flex: 1, padding: '24px 0 24px', fontFamily: "'Space Grotesk', sans-serif",
    overflowY: 'auto', minHeight: 0,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '0 24px 20px', borderBottom: '1px solid #1f1f28', marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: 700, color: '#ece9e2' },
  subtitle: { fontSize: 11, color: '#5a5a6e', marginTop: 3 },
  statsRow: {
    display: 'flex', gap: 12, padding: '0 24px', marginBottom: 20, flexWrap: 'wrap',
  },
  statCard: {
    flex: '1 1 120px', background: '#111116', border: '1px solid #1f1f28',
    borderRadius: 10, padding: '14px 16px',
  },
  mapRow: {
    display: 'flex', gap: 16, padding: '0 24px', marginBottom: 20, alignItems: 'flex-start',
  },
  pricePin: {
    flexShrink: 0, width: 140, display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 6, paddingTop: 4,
  },
  pricePinLine: { width: 1, flex: 1, minHeight: 12, background: '#2a2a38' },
  pricePinLabel: {
    fontSize: 12, fontWeight: 700, color: '#ece9e2',
    fontFamily: "'JetBrains Mono', monospace", textAlign: 'center', whiteSpace: 'nowrap',
  },
  baseline: {
    padding: '10px 24px', borderTop: '1px solid #1a1a22',
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
  },
};

// Pulse animation for CONFIRMING levels
const _brainStyle = document.createElement('style');
_brainStyle.textContent = `
  @keyframes brainPulse {
    0%, 100% { border-color: rgba(167,139,250,0.4); box-shadow: none; }
    50%       { border-color: rgba(167,139,250,0.8); box-shadow: 0 0 8px rgba(167,139,250,0.25); }
  }
`;
document.head.appendChild(_brainStyle);

Object.assign(window, { Brain });
