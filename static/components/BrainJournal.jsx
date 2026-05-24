/*
  AlphaBrain v4 — Trade Journal
  Reads ONLY from /api/brain/trades (brain_trades.csv).
  Completely isolated from AlphaBot journal — DO NOT mix data sources.
*/

const BJ_ACCENT = '#a78bfa';

function BrainJournal() {
  const [trades, setTrades] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter]   = React.useState('all');   // 'all' | 'open' | 'closed' | 'LONG' | 'SHORT'
  const [sortCol, setSortCol] = React.useState('ts');
  const [sortDir, setSortDir] = React.useState(-1);       // -1 desc, 1 asc

  React.useEffect(() => {
    fetch('/api/brain/trades')
      .then(r => r.ok ? r.json() : { trades: [] })
      .then(d => { setTrades(d.trades || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = React.useMemo(() => {
    let t = [...trades];
    if (filter === 'open')   t = t.filter(x => x.open);
    if (filter === 'closed') t = t.filter(x => !x.open);
    if (filter === 'LONG')   t = t.filter(x => x.direction === 'LONG');
    if (filter === 'SHORT')  t = t.filter(x => x.direction === 'SHORT');
    t.sort((a, b) => {
      const va = a[sortCol] ?? '';
      const vb = b[sortCol] ?? '';
      return sortDir * (va < vb ? -1 : va > vb ? 1 : 0);
    });
    return t;
  }, [trades, filter, sortCol, sortDir]);

  const closed = trades.filter(t => !t.open);
  const wins   = closed.filter(t => parseFloat(t.r_multiple || 0) > 0);
  const totalR = closed.reduce((s, t) => s + parseFloat(t.r_multiple || 0), 0);

  const sort = col => {
    if (sortCol === col) setSortDir(d => d * -1);
    else { setSortCol(col); setSortDir(-1); }
  };

  const Th = ({ col, children }) => (
    <th onClick={() => sort(col)} style={{...bjS.th, cursor:'pointer',
      color: sortCol === col ? BJ_ACCENT : '#3e3e52'}}>
      {children}{sortCol === col ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}
    </th>
  );

  const rColor = r => {
    const v = parseFloat(r);
    if (isNaN(v)) return '#5a5a6e';
    return v > 0 ? '#00d084' : v < 0 ? '#ff4d6d' : '#5a5a6e';
  };

  const dirColor = d => d === 'LONG' ? '#00d084' : '#ff4d6d';

  if (loading) return (
    <div style={{padding:40, color:'#5a5a6e', fontFamily:"'Space Grotesk',sans-serif"}}>
      Loading Brain trades…
    </div>
  );

  return (
    <div style={bjS.page}>
      {/* Header */}
      <div style={bjS.header}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <span style={{fontSize:20, color:BJ_ACCENT}}>◗</span>
          <div>
            <div style={bjS.title}>Brain Journal</div>
            <div style={bjS.subtitle}>AlphaBrain v4 trades only · isolated from AlphaBot</div>
          </div>
        </div>
        {/* Summary stats */}
        <div style={{display:'flex', gap:20, alignItems:'center'}}>
          {[
            { label:'Trades', val: closed.length },
            { label:'WR',     val: closed.length ? `${Math.round(wins.length / closed.length * 100)}%` : '—' },
            { label:'Avg R',  val: closed.length ? (totalR / closed.length).toFixed(2) : '—', color: totalR >= 0 ? '#00d084' : '#ff4d6d' },
            { label:'Total R', val: totalR.toFixed(2), color: totalR >= 0 ? '#00d084' : '#ff4d6d' },
          ].map(({label, val, color}) => (
            <div key={label} style={{textAlign:'right'}}>
              <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.4px'}}>{label}</div>
              <div style={{fontSize:16, fontWeight:700, color: color || '#ece9e2',
                           fontFamily:"'JetBrains Mono',monospace"}}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div style={bjS.filterBar}>
        {['all', 'open', 'closed', 'LONG', 'SHORT'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            ...bjS.filterBtn,
            background: filter === f ? 'rgba(167,139,250,0.12)' : 'transparent',
            color:       filter === f ? BJ_ACCENT : '#5a5a6e',
            border:      filter === f ? '1px solid rgba(167,139,250,0.3)' : '1px solid transparent',
          }}>
            {f.toUpperCase()}
          </button>
        ))}
        <span style={{marginLeft:'auto', fontSize:11, color:'#3e3e52'}}>
          {filtered.length} trade{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{padding:'48px 24px', textAlign:'center', color:'#3e3e52',
                     fontSize:13, fontFamily:"'Space Grotesk',sans-serif"}}>
          {trades.length === 0
            ? 'No Brain trades yet — brain_trades.csv will be created on first signal.'
            : 'No trades match the current filter.'}
        </div>
      ) : (
        <div style={{overflowX:'auto', padding:'0 24px'}}>
          <table style={bjS.table}>
            <thead>
              <tr>
                <Th col="trade_id">ID</Th>
                <Th col="timestamp_entry">Date</Th>
                <Th col="direction">Dir</Th>
                <Th col="level_id">Level</Th>
                <Th col="level_type">Type</Th>
                <Th col="level_strength">Strength</Th>
                <Th col="entry">Entry</Th>
                <Th col="sl">SL</Th>
                <Th col="exit_price">Exit</Th>
                <Th col="r_multiple">R</Th>
                <Th col="exit_reason">Reason</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const r = parseFloat(t.r_multiple);
                const isOpen = t.open;
                return (
                  <tr key={t.trade_id || i} style={{
                    background: i % 2 === 0 ? '#0d0d11' : 'transparent',
                    opacity: isOpen ? 1 : 0.85,
                  }}>
                    <td style={{...bjS.td, color: BJ_ACCENT, fontFamily:"'JetBrains Mono',monospace",
                                 fontSize:10}}>{t.trade_id || '—'}</td>
                    <td style={{...bjS.td, color:'#5a5a6e', fontSize:10}}>
                      {(t.timestamp_entry || '').slice(0,16).replace('T',' ')}
                      {isOpen && <span style={{marginLeft:6, fontSize:9, color:BJ_ACCENT,
                                               background:'rgba(167,139,250,0.12)', padding:'1px 4px',
                                               borderRadius:3}}>OPEN</span>}
                    </td>
                    <td style={{...bjS.td, color: dirColor(t.direction), fontWeight:600,
                                 fontSize:11}}>{t.direction}</td>
                    <td style={{...bjS.td, fontSize:10, fontFamily:"'JetBrains Mono',monospace",
                                 color:'#ece9e2'}}>{t.level_id || '—'}</td>
                    <td style={{...bjS.td, fontSize:10, color:'#5a5a6e'}}>
                      {(t.level_type || '').replace(/_/g,' ')}
                    </td>
                    <td style={{...bjS.td, fontSize:10}}>
                      <span style={{color: t.level_strength === 'HIGH' ? '#00d084'
                                         : t.level_strength === 'MEDIUM' ? '#F7931A' : '#5a5a6e'}}>
                        {t.level_strength || '—'}
                      </span>
                    </td>
                    <td style={{...bjS.td, fontFamily:"'JetBrains Mono',monospace", fontSize:11}}>
                      {t.entry ? `$${parseFloat(t.entry).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'}
                    </td>
                    <td style={{...bjS.td, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#ff4d6d'}}>
                      {t.sl ? `$${parseFloat(t.sl).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'}
                    </td>
                    <td style={{...bjS.td, fontFamily:"'JetBrains Mono',monospace", fontSize:11}}>
                      {isOpen ? <span style={{color:'#3e3e52'}}>open</span>
                               : t.exit_price ? `$${parseFloat(t.exit_price).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'}
                    </td>
                    <td style={{...bjS.td, fontFamily:"'JetBrains Mono',monospace", fontSize:13,
                                 fontWeight:700, color: isOpen ? '#5a5a6e' : rColor(t.r_multiple)}}>
                      {isOpen ? '…' : isNaN(r) ? '—' : (r >= 0 ? '+' : '') + r.toFixed(2) + 'R'}
                    </td>
                    <td style={{...bjS.td, fontSize:10, color:'#5a5a6e'}}>
                      {t.exit_reason || (isOpen ? '—' : '—')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const bjS = {
  page: { flex:1, fontFamily:"'Space Grotesk',sans-serif", overflowY:'auto' },
  header: {
    display:'flex', justifyContent:'space-between', alignItems:'flex-start',
    padding:'24px 24px 16px', borderBottom:'1px solid #1f1f28',
  },
  title: { fontSize:18, fontWeight:700, color:'#ece9e2' },
  subtitle: { fontSize:11, color:'#5a5a6e', marginTop:3 },
  filterBar: {
    display:'flex', gap:6, padding:'12px 24px', borderBottom:'1px solid #1a1a22',
    alignItems:'center',
  },
  filterBtn: {
    padding:'4px 12px', borderRadius:5, cursor:'pointer', fontSize:11,
    fontWeight:600, fontFamily:"'Space Grotesk',sans-serif",
  },
  table: { width:'100%', borderCollapse:'collapse', fontSize:12 },
  th: {
    padding:'10px 12px', textAlign:'left', fontSize:10, fontWeight:600,
    letterSpacing:'0.5px', textTransform:'uppercase', borderBottom:'1px solid #1f1f28',
    userSelect:'none', whiteSpace:'nowrap',
  },
  td: { padding:'9px 12px', borderBottom:'1px solid #0f0f14', color:'#ece9e2' },
};

Object.assign(window, { BrainJournal });
