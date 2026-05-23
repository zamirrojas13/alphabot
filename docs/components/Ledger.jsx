
// ── helpers shared by both Live and Import views ─────────────────────────────

function buildRows(trades, startBalance) {
  let bal = startBalance;
  // Accumulate forward (oldest → newest), then display newest first
  const rows = trades.map(t => {
    const eqBefore = bal;
    bal += (t.pnl_net_usd || 0);
    return { ...t, balance_after: +bal.toFixed(2), _eq_before: +eqBefore.toFixed(2) };
  });
  return [...rows].reverse();
}

function estimateFee(t, eqBefore) {
  const ep = parseFloat(t.entry_price) || 0;
  if (!ep) return null;
  if (typeof t.fees_usd === 'number' && t.fees_usd > 0)
    return { fee: +t.fees_usd.toFixed(2), estimated: false };
  let qty = parseFloat(t.nano_qty);
  let estimated = true;
  if (isNaN(qty) || !qty) {
    const tierRisk = { 1: 0.04, 2: 0.03, 3: 0.015 }[+t.tier] || 0.03;
    const slPct = t.sl_distance_pct
      ? Math.abs(parseFloat(t.sl_distance_pct)) / 100
      : (t.sl_price ? Math.abs(ep - parseFloat(t.sl_price)) / ep : 0);
    if (!slPct) return null;
    qty = Math.floor((eqBefore || 10000) * tierRisk / (ep * 0.01 * slPct));
    if (!qty) return null;
  }
  return { fee: +(ep * 0.01 * qty * 0.0012 * 2).toFixed(2), estimated };
}

function calcStats(trades, rows) {
  const closed = trades.filter(t => !t.open && t.pnl_net_usd != null);
  // Build a map from trade_id → _eq_before from rows (which include balance tracking)
  const eqMap = {};
  if (rows) rows.forEach(r => { if (r.trade_id) eqMap[r.trade_id] = r._eq_before; });
  let totalFees = 0;
  closed.forEach(t => {
    const fi = estimateFee(t, eqMap[t.trade_id]);
    if (fi) totalFees += fi.fee;
  });
  return {
    closed,
    totalGross: closed.reduce((s,t) => s + (t.pnl_usd   || 0), 0),
    totalFees,
    totalNet:   closed.reduce((s,t) => s + (t.pnl_net_usd|| 0), 0),
    totalR:     closed.reduce((s,t) => s + (t.r_multiple || 0), 0),
    wins:       closed.filter(t => (t.r_multiple||0) > 0).length,
    losses:     closed.filter(t => (t.r_multiple||0) < 0).length,
  };
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const numFields = ['entry_price','sl_price','tp_price','position_size_btc','position_size_usd',
    'nano_qty','max_risk_usd','exit_price','bars_held','pnl_usd','pnl_pct','r_multiple',
    'fees_usd','pnl_net_usd','tier','sl_distance_pct','rr_target'];
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    numFields.forEach(k => {
      if (row[k] && row[k] !== 'None' && row[k] !== '') row[k] = parseFloat(row[k]);
    });
    row.tier = parseInt(row.tier) || 1;
    row.open = !row.exit_price || row.exit_price === '';
    return row;
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

function LedgerKPIs({ stats, startBalance, hasTrades }) {
  const { totalGross, totalFees, totalNet, totalR, closed } = stats;
  const returnPct = startBalance > 0 ? (totalNet / startBalance * 100) : 0;
  const winRate   = closed.length ? Math.round(stats.wins / closed.length * 100) : null;

  const kpis = [
    { label:'Gross PnL',   val: hasTrades ? `${totalGross>=0?'+':'-'}$${Math.abs(totalGross).toFixed(2)}`  : '—', col: hasTrades ? (totalGross>=0?'#00d084':'#ff4d6d') : '#3e3e52' },
    { label:'Total Fees',  val: hasTrades && totalFees > 0 ? `~-$${totalFees.toFixed(2)}` : (hasTrades ? '$0.00' : '—'), col: hasTrades && totalFees>0 ? '#5a5a6e' : '#3e3e52' },
    { label:'Net PnL',     val: hasTrades ? `${totalNet>=0?'+':'-'}$${Math.abs(totalNet).toFixed(2)}`      : '—', col: hasTrades ? (totalNet>=0?'#00d084':'#ff4d6d') : '#3e3e52' },
    { label:'Total R',     val: hasTrades ? `${totalR>=0?'+':''}${totalR.toFixed(2)}R`         : '—', col: hasTrades ? (totalR>=0?'#00d084':'#ff4d6d') : '#3e3e52' },
    { label:'Win Rate',    val: hasTrades ? `${winRate}%`                                      : '—', col: hasTrades ? (winRate>=50?'#00d084':'#ff4d6d') : '#3e3e52',
      sub: hasTrades ? `${stats.wins}W · ${stats.losses}L` : null },
    { label:'Return',      val: hasTrades ? `${returnPct>=0?'+':''}${returnPct.toFixed(1)}%`   : '—', col: hasTrades ? (returnPct>=0?'#00d084':'#ff4d6d') : '#3e3e52' },
  ];

  return (
    <div style={lStyles.summRow}>
      {kpis.map(k => (
        <div key={k.label} style={lStyles.summCard}>
          <div style={lStyles.summLabel}>{k.label}</div>
          <div style={{...lStyles.summVal, color: k.col}}>{k.val}</div>
          {k.sub && <div style={{fontSize:10, color:'#3e3e52', marginTop:4, fontFamily:"'JetBrains Mono',monospace"}}>{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function LedgerChart({ trades, startBalance }) {
  const W = 600, H = 100, PAD_T = 10, PAD_B = 10;
  const closed = trades.filter(t => !t.open);
  const points = [startBalance];
  let bal = startBalance;
  closed.forEach(t => { bal += (t.pnl_net_usd||0); points.push(+bal.toFixed(2)); });

  const minV = Math.min(...points), maxV = Math.max(...points), range = maxV - minV || 1;
  const usable = H - PAD_T - PAD_B;
  const pts = points.map((v,i) =>
    `${(i/(points.length-1||1))*W},${PAD_T + usable - ((v-minV)/range)*usable}`
  ).join(' ');

  const fmt = n => (+n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const returnPct = startBalance > 0 ? ((bal - startBalance) / startBalance * 100) : 0;

  return (
    <div style={lStyles.chartCard}>
      <div style={lStyles.chartHead}>
        <span style={lStyles.cardTitle}>Equity Curve</span>
        <span style={{fontSize:12, fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>
          <span style={{color:'#5a5a6e'}}>${(+startBalance).toLocaleString('en-US')} → </span>
          <span style={{color:'#00d084'}}>${fmt(bal)}</span>
          <span style={{fontSize:11, color: returnPct>=0?'#00d084':'#ff4d6d', marginLeft:8}}>
            {returnPct>=0?'+':''}{returnPct.toFixed(1)}%
          </span>
        </span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block'}}>
        <defs>
          <linearGradient id="ledGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F7931A" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="#F7931A" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#ledGrad)" />
        <polyline points={pts} fill="none" stroke="#F7931A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        {/* Only show dots when few trades — skip to avoid noise on large datasets */}
        {closed.length <= 60 && points.slice(1).map((v, i) => {
          const x = ((i+1)/(points.length-1||1))*W;
          const y = PAD_T + usable - ((v-minV)/range)*usable;
          const isWin = closed[i] && (closed[i].r_multiple||0) > 0;
          return <circle key={i} cx={x} cy={y} r={3} fill={isWin?'#00d084':'#ff4d6d'} opacity={0.7}/>;
        })}
      </svg>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10, paddingTop:8, borderTop:'1px solid #1a1a22'}}>
        <div>
          <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:2}}>START</div>
          <div style={{fontSize:13, fontWeight:600, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace"}}>${(+startBalance).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <span style={{fontSize:11, color:'#2a2a38'}}>{closed.length} closed trade{closed.length!==1?'s':''}</span>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:2}}>CURRENT</div>
          <div style={{fontSize:13, fontWeight:700, color:'#00d084', fontFamily:"'JetBrains Mono',monospace"}}>${fmt(bal)}</div>
        </div>
      </div>
    </div>
  );
}

// Strategy names from window.STRAT_NAMES (Overview.jsx — single source of truth)

function LedgerTable({ rows }) {
  const exitColor = r => ({
    tp_hit:'#00d084', tp:'#00d084',
    sl_hit:'#ff4d6d', sl:'#ff4d6d',
    trail_stop:'#F7931A', trail:'#F7931A',
    time_exit:'#a78bfa', time:'#a78bfa',
  }[r] || '#5a5a6e');
  const exitLabel = r => ({
    tp_hit:'TP Hit', tp:'TP Hit',
    sl_hit:'SL Hit', sl:'SL Hit',
    trail_stop:'Trail Stop', trail:'Trail Stop',
    time_exit:'Time Exit', time:'Time Exit',
    manual_close:'Manual', liquidation:'Liq',
  }[r] || (r || '—'));
  const stratName = s => (window.STRAT_NAMES||{})[s?.toLowerCase()] || s || '—';
  const fmt  = n => typeof n === 'number' ? n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
  const fmtDate = ts => {
    if (!ts) return '—';
    try {
      const d = new Date(ts.includes('T') ? ts : ts.replace(' ','T'));
      return d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    } catch { return ts.slice(0,10); }
  };

  return (
    <div style={lStyles.tableWrap}>
      <table style={lStyles.table}>
        <thead>
          <tr>
            {['#','Date','Direction','Setup','Tier','Quality','Entry','Exit','Result','Bars','Gross PnL','Fees','Net PnL','R','Balance'].map(h => (
              <th key={h} style={lStyles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={15} style={{...lStyles.td, textAlign:'center', padding:'40px', color:'#2a2a38'}}>
                <div style={{fontSize:22, opacity:0.15, marginBottom:8}}>◫</div>
                <div style={{fontSize:13, color:'#3e3e52'}}>No closed trades yet</div>
                <div style={{fontSize:11, color:'#2a2a38', marginTop:4}}>The table fills automatically as your bot completes trades</div>
              </td>
            </tr>
          ) : rows.map((t, idx) => (
            <tr key={t.trade_id || idx} style={{...lStyles.tr, background: idx%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
              <td style={{...lStyles.monoTd, fontSize:10, color:'#3e3e52'}}>{t.trade_id || idx+1}</td>
              <td style={{...lStyles.monoTd, fontSize:11, color:'#5a5a6e', whiteSpace:'nowrap'}}>{fmtDate(t.timestamp_entry)}</td>
              <td style={lStyles.td}>
                <span style={{fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
                  ...(t.direction==='long'
                    ? {background:'rgba(0,208,132,0.12)',color:'#00d084'}
                    : {background:'rgba(255,77,109,0.12)',color:'#ff4d6d'})}}>
                  {(t.direction||'').toUpperCase()}
                </span>
              </td>
              <td style={{...lStyles.td, color:'#F7931A', fontSize:11, maxWidth:160, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={t.setup_type}>{stratName(t.setup_type)}</td>
              <td style={lStyles.td}><TierBadge tier={t.tier} /></td>
              <td style={lStyles.td}>{t.grade ? <GradeBadge grade={t.grade} /> : <span style={{color:'#2a2a38'}}>—</span>}</td>
              <td style={lStyles.monoTd}>${fmt(t.entry_price)}</td>
              <td style={lStyles.monoTd}>{t.exit_price ? `$${fmt(t.exit_price)}` : '—'}</td>
              <td style={lStyles.td}>
                <span style={{fontSize:11, fontWeight:600, color:exitColor(t.exit_reason), fontFamily:"'JetBrains Mono',monospace"}}>
                  {exitLabel(t.exit_reason)}
                </span>
              </td>
              <td style={{...lStyles.monoTd, color:'#5a5a6e'}}>{t.bars_held ?? '—'}</td>
              <td style={{...lStyles.monoTd, color:(t.pnl_usd||0)>=0?'#00d084':'#ff4d6d'}}>
                {typeof t.pnl_usd==='number' ? `${t.pnl_usd>=0?'+':'-'}$${fmt(Math.abs(t.pnl_usd))}` : '—'}
              </td>
              <td style={{...lStyles.monoTd, color:'#5a5a6e'}}>
                {(() => { const fi = estimateFee(t, t._eq_before); return fi ? `${fi.estimated?'~':''}-$${fi.fee.toFixed(2)}` : '—'; })()}
              </td>
              <td style={{...lStyles.monoTd, fontWeight:700, color:(t.pnl_net_usd||0)>=0?'#00d084':'#ff4d6d'}}>
                {typeof t.pnl_net_usd==='number' ? `${t.pnl_net_usd>=0?'+':'-'}$${fmt(Math.abs(t.pnl_net_usd))}` : '—'}
              </td>
              <td style={{...lStyles.monoTd, fontWeight:700, color:(t.r_multiple||0)>=0?'#00d084':'#ff4d6d'}}>
                {typeof t.r_multiple==='number' ? `${t.r_multiple>=0?'+':''}${t.r_multiple.toFixed(2)}R` : '—'}
              </td>
              <td style={{...lStyles.monoTd, color:'#F7931A'}}>${fmt(t.balance_after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

function Ledger({ data, viewMode, setViewMode, dateRange }) {
  const START_BAL = (data.account?.account_size > 0 ? data.account.account_size : null)
                    || data.bot_state?.account_size || 10_000;
  const isSim     = viewMode === 'backtest';

  const trades    = data.trades.filter(t => !t.open && t.pnl_net_usd != null);
  const rows      = buildRows(trades, START_BAL);
  const stats     = calcStats(trades, rows);

  const subLabel  = viewMode === 'backtest'
    ? `Backtest · $${START_BAL.toLocaleString('en-US')} start · ${dateRange?.start?.slice(0,4) ?? '2017'}→${dateRange?.end?.slice(0,4) ?? 'now'}`
    : viewMode === 'paper'
    ? `Paper trading · $${START_BAL.toLocaleString('en-US')} simulated · DRY trades`
    : 'Live — syncing from bot ledger';

  const exportCSV = () => {
    const headers = ['trade_id','timestamp_entry','timestamp_exit','setup_type','direction','tier',
      'entry_price','exit_price','exit_reason','pnl_usd','fees_usd','pnl_net_usd','r_multiple','bars_held'];
    const lines = [headers.join(',')];
    rows.forEach(t => {
      lines.push(headers.map(h => {
        const v = t[h] ?? '';
        return String(v).includes(',') ? `"${v}"` : v;
      }).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `alphabot_trades_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div style={lStyles.wrap}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
        <div>
          <div style={lStyles.pageTitle}>Ledger &amp; P&amp;L</div>
          <div style={{fontSize:12, color: isSim ? '#F7931A' : '#00d084', marginTop:4}}>{subLabel}</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          {rows.length > 0 && (
            <button onClick={exportCSV} style={{
              padding:'7px 14px', borderRadius:6, border:'1px solid #1f1f28',
              background:'#111116', color:'#5a5a6e', cursor:'pointer',
              fontFamily:"'Space Grotesk',sans-serif", fontSize:12, fontWeight:600,
            }}>⬇ Export CSV</button>
          )}
          {viewMode !== undefined && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} dateRange={dateRange} />}
        </div>
      </div>

      {/* Debug counter */}
      <div style={{fontSize:10, color:'#2a2a38', fontFamily:"'JetBrains Mono',monospace", marginBottom:10, textAlign:'right'}}>
        API returned {(data.trades||[]).length} trades · {trades.length} closed with P&L · displaying {rows.length} rows
      </div>

      <LedgerKPIs stats={stats} startBalance={START_BAL} hasTrades={trades.length > 0} />
      <LedgerChart trades={trades} startBalance={START_BAL} />
      <LedgerTable rows={rows} />
    </div>
  );
}

const lStyles = {
  wrap:        { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle:   { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },

  // Tabs
  tabBar:      { display:'flex', gap:4, background:'#0d0d11', borderRadius:8, padding:4, border:'1px solid #1f1f28' },
  tab:         { padding:'7px 16px', borderRadius:6, border:'none', background:'transparent', color:'#3e3e52', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif", display:'flex', alignItems:'center', transition:'all 0.15s' },
  tabActive:   { background:'#111116', color:'#00d084', border:'1px solid #1f1f28' },
  tabImportActive: { background:'#111116', color:'#F7931A', border:'1px solid rgba(247,147,26,0.25)' },

  // KPIs
  summRow:     { display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:14 },
  summCard:    { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'14px 16px' },
  summLabel:   { fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', marginBottom:6, textTransform:'uppercase' },
  summVal:     { fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2' },

  // Chart
  chartCard:   { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 20px', marginBottom:14 },
  chartHead:   { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  cardTitle:   { fontSize:13, fontWeight:600, color:'#ece9e2' },
  chartFooter: { display:'flex', justifyContent:'space-between', marginTop:8 },
  footLbl:     { fontSize:11, color:'#3e3e52', fontFamily:"'JetBrains Mono',monospace" },

  // Table
  tableWrap:   { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, overflow:'hidden' },
  table:       { width:'100%', borderCollapse:'collapse' },
  th:          { textAlign:'left', fontSize:10, color:'#3e3e52', fontWeight:600, padding:'11px 10px', letterSpacing:'0.4px', background:'#0d0d11', borderBottom:'1px solid #1a1a22', whiteSpace:'nowrap' },
  tr:          { borderBottom:'1px solid #15151d' },
  td:          { padding:'10px 10px', fontSize:12, color:'#ece9e2', verticalAlign:'middle' },
  monoTd:      { padding:'10px 10px', fontSize:11, color:'#ece9e2', verticalAlign:'middle', fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap' },

  // Import
  importBanner: { background:'rgba(247,147,26,0.06)', border:'1px solid rgba(247,147,26,0.18)', borderRadius:10, padding:'14px 18px', marginBottom:14 },
  importCard:   { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'20px 22px', marginBottom:14 },
  csvTextarea:  { width:'100%', height:160, background:'#0d0d11', border:'1px solid #1f1f28', borderRadius:7, padding:'12px 14px', color:'#5a5a6e', fontSize:11, fontFamily:"'JetBrains Mono',monospace", outline:'none', resize:'vertical', boxSizing:'border-box', lineHeight:1.6 },
  uploadBtn:    { padding:'8px 16px', borderRadius:6, border:'1px solid #2a2a38', background:'#0d0d11', color:'#5a5a6e', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" },
  parseBtn:     { padding:'10px 22px', borderRadius:7, border:'none', background:'rgba(247,147,26,0.15)', color:'#F7931A', fontSize:13, fontWeight:700, fontFamily:"'Space Grotesk',sans-serif", border:'1px solid rgba(247,147,26,0.3)' },
};

Object.assign(window, { Ledger });
