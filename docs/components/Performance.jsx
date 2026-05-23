
// ── data helpers ──────────────────────────────────────────────────────────────

function perf_monthlyReturns(closed, startBal) {
  let bal = startBal;
  const months = {};
  const sorted = [...closed].sort((a,b)=>(a.timestamp_exit||'').localeCompare(b.timestamp_exit||''));
  for (const t of sorted) {
    const ym = (t.timestamp_exit||'').slice(0,7);
    if (!ym) continue;
    if (!months[ym]) months[ym] = { start: bal, pnl:0, r:0, trades:0, maxWin:-Infinity, maxLoss:Infinity };
    const pnl = parseFloat(t.pnl_net_usd || t.pnl_usd || 0);
    const r   = parseFloat(t.r_multiple || 0);
    months[ym].pnl += pnl;
    months[ym].r   += r;
    months[ym].trades++;
    if (r > months[ym].maxWin)  months[ym].maxWin  = r;
    if (r < months[ym].maxLoss) months[ym].maxLoss = r;
    bal += pnl;
    months[ym].end = bal;
  }
  return Object.entries(months).map(([ym, d]) => ({
    ym,
    pct: d.start > 0 ? +((d.pnl / d.start) * 100).toFixed(2) : 0,
    pnl: +d.pnl.toFixed(2),
    r:   +d.r.toFixed(2),
    trades: d.trades,
    maxWin:  d.maxWin  === -Infinity ? 0 : +d.maxWin.toFixed(2),
    maxLoss: d.maxLoss ===  Infinity ? 0 : +d.maxLoss.toFixed(2),
  }));
}

function perf_rollingWR(closed, windowN) {
  const sorted = [...closed].sort((a,b)=>(a.timestamp_exit||'').localeCompare(b.timestamp_exit||''));
  let lastWR = null;
  return sorted.map((t, i) => {
    const win = sorted.slice(Math.max(0, i - windowN + 1), i + 1);
    if (win.length >= 3) {
      const wins = win.filter(x => (parseFloat(x.r_multiple)||0) > 0).length;
      lastWR = Math.round(wins / win.length * 100);
    }
    // Carry forward last known value so chart has no gaps
    return { date: (t.timestamp_exit||'').slice(0,10), wr: lastWR };
  });
}

function perf_drawdownSeries(closed, startBal) {
  let bal = startBal, peak = startBal;
  const sorted = [...closed].sort((a,b)=>(a.timestamp_exit||'').localeCompare(b.timestamp_exit||''));
  const pts = [{ idx:0, dd:0 }];
  sorted.forEach((t, i) => {
    // Use gross pnl_usd (no fees) to match backtest_v9 equity curve methodology.
    // v9 computed DD on pre-fee equity; using pnl_net_usd inflated DD by ~12% in paper data.
    bal += parseFloat(t.pnl_usd || t.pnl_net_usd || 0);
    if (bal > peak) peak = bal;
    pts.push({ idx: i+1, dd: peak > 0 ? +((bal-peak)/peak*100).toFixed(2) : 0 });
  });
  return pts;
}

// ── SVG rolling WR chart ─────────────────────────────────────────────────────
function RollingWRChart({ points, btWR, tradeCount }) {
  if (tradeCount < 10) return (
    <div style={{height:100, display:'flex', alignItems:'center', justifyContent:'center', color:'#3e3e52', fontSize:12, textAlign:'center', padding:'0 20px'}}>
      Win rate trend requires 10+ trades<br/>
      <span style={{color:'#2a2a38', fontSize:11, marginTop:4, display:'block'}}>({tradeCount} trade{tradeCount!==1?'s':''} so far)</span>
    </div>
  );
  if (!points.length) return (
    <div style={{height:100, display:'flex', alignItems:'center', justifyContent:'center', color:'#2a2a38', fontSize:12}}>
      No data
    </div>
  );
  const W=600, H=100, PAD_T=10, PAD_B=8;
  const minV=20, maxV=100, range=maxV-minV, usable=H-PAD_T-PAD_B;
  const validPts = points.filter(p => p.wr != null);
  if (!validPts.length) return (
    <div style={{height:H, display:'flex', alignItems:'center', justifyContent:'center', color:'#3e3e52', fontSize:12}}>
      Need 3+ trades to compute win rate
    </div>
  );
  const ptStr = points.map((p, i) => {
    const x = (i / (points.length - 1 || 1)) * W;
    const clamped = Math.max(minV, Math.min(maxV, p.wr ?? minV));
    const y = PAD_T + usable - ((clamped - minV) / range) * usable;
    return `${x},${y}`;
  }).join(' ');
  const btY = PAD_T + usable - ((Math.max(minV, Math.min(maxV, btWR)) - minV) / range) * usable;
  const lastValid = validPts[validPts.length - 1];
  const lastIdx = points.length - 1 - [...points].reverse().findIndex(p => p.wr != null);
  const lx = (lastIdx / (points.length - 1 || 1)) * W;
  const lclamped = Math.max(minV, Math.min(maxV, lastValid.wr));
  const ly = PAD_T + usable - ((lclamped - minV) / range) * usable;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block'}}>
      <line x1="0" y1={btY} x2={W} y2={btY} stroke="#F7931A" strokeWidth="1" strokeDasharray="6 4" opacity="0.5"/>
      <polyline points={ptStr} fill="none" stroke="#00d084" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={lx} cy={ly} r="4" fill="#00d084"/>
      <text x="4" y={btY-3} fontSize="9" fill="#F7931A" opacity="0.7">Backtest avg: {btWR}%</text>
    </svg>
  );
}

// ── SVG drawdown chart ────────────────────────────────────────────────────────
function DrawdownChart({ points, tradeCount }) {
  if (tradeCount < 5) return (
    <div style={{height:100, display:'flex', alignItems:'center', justifyContent:'center', color:'#3e3e52', fontSize:12, textAlign:'center', padding:'0 20px'}}>
      Insufficient trades to show drawdown history<br/>
      <span style={{color:'#2a2a38', fontSize:11, marginTop:4, display:'block'}}>Need 5+ trades · {tradeCount} so far</span>
    </div>
  );
  const W=600, H=100, PAD_T=6, PAD_B=8;
  const minV=Math.min(-20, Math.min(...points.map(p=>p.dd))-2);
  const maxV=2, range=maxV-minV, usable=H-PAD_T-PAD_B;
  const toY = v => PAD_T + usable - ((v-minV)/range)*usable;
  const zeroY = toY(0);
  const ptStr = points.map((p,i)=>`${(i/(points.length-1||1))*W},${toY(p.dd)}`).join(' ');
  const l10Y = toY(-10), l15Y = toY(-15);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block'}}>
      {/* Zero line */}
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#2a2a38" strokeWidth="1"/>
      {/* -10% line */}
      <line x1="0" y1={l10Y} x2={W} y2={l10Y} stroke="#F7931A" strokeWidth="1" strokeDasharray="5 4" opacity="0.5"/>
      {/* -15% line */}
      <line x1="0" y1={l15Y} x2={W} y2={l15Y} stroke="#ff4d6d" strokeWidth="1" strokeDasharray="5 4" opacity="0.6"/>
      {/* Filled area */}
      <polygon points={`0,${zeroY} ${ptStr} ${W},${zeroY}`} fill="rgba(255,77,109,0.12)"/>
      <polyline points={ptStr} fill="none" stroke="#ff4d6d" strokeWidth="1.5" strokeLinejoin="round"/>
      {/* Labels */}
      <text x="4" y={l10Y-3} fontSize="9" fill="#F7931A" opacity="0.7">-10% T2</text>
      <text x="4" y={l15Y-3} fontSize="9" fill="#ff4d6d" opacity="0.7">-15% CB</text>
    </svg>
  );
}

// ── main Performance component ────────────────────────────────────────────────
function Performance({ data, viewMode, setViewMode, dateRange, simData }) {
  const closed   = (data.trades || []).filter(t => !t.open && t.pnl_net_usd != null);
  const startBal = data.account?.account_size || 10000;
  const [hovCell, setHovCell] = React.useState(null);

  // Compute data
  const monthly  = React.useMemo(() => perf_monthlyReturns(closed, startBal), [closed, startBal]);
  const rollingWR = React.useMemo(() => perf_rollingWR(closed, 10), [closed]);
  const ddSeries  = React.useMemo(() => perf_drawdownSeries(closed, startBal), [closed, startBal]);

  // Monthly table structure
  const byYear = {};
  monthly.forEach(m => {
    const [y, mo] = m.ym.split('-');
    if (!byYear[y]) byYear[y] = {};
    byYear[y][parseInt(mo)-1] = m;
  });
  const years   = Object.keys(byYear).sort().reverse();
  const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Leaderboard — current month for live/paper, most recent BT month for backtest
  const thisMonth   = new Date().toISOString().slice(0,7);
  const leaderMonth = (viewMode === 'backtest' && monthly.length > 0)
    ? monthly[monthly.length - 1].ym
    : thisMonth;
  const monthT      = closed.filter(t => (t.timestamp_exit||'').startsWith(leaderMonth));
  const leaderMonthLabel = (() => {
    const [y, mo] = leaderMonth.split('-');
    return `${MONTHS[parseInt(mo)-1]} ${y}`;
  })();
  const leaderMap = {};
  monthT.forEach(t => {
    const k = t.setup_type || '—';
    if (!leaderMap[k]) leaderMap[k] = { w:0, l:0, r:0 };
    const r = parseFloat(t.r_multiple || 0);
    if (r > 0) leaderMap[k].w++; else leaderMap[k].l++;
    leaderMap[k].r += r;
  });
  const leaderRows = Object.entries(leaderMap)
    .map(([k,v]) => { const tot=v.w+v.l; return { type:k, ...v, total:tot, avgR: tot ? +(v.r/tot).toFixed(2) : 0 }; })
    .sort((a,b) => b.r - a.r);

  // Live vs BT comparison
  const BT = { wr:57, avgR:0.40, tpm:2.5, maxDD:17.7 };
  const { stats } = data;
  const liveWR    = closed.length ? stats?.win_rate ?? null : null;
  const liveAvgR  = closed.length ? stats?.avg_r  ?? null : null;
  const liveMaxDD = closed.length ? Math.abs(stats?.max_drawdown ?? stats?.max_dd_pct ?? 0) : null;
  const firstDate = closed.length ? new Date(closed.sort((a,b)=>(a.timestamp_exit||'').localeCompare(b.timestamp_exit||''))[0].timestamp_exit||'') : null;
  const monthsActive = firstDate ? Math.max(1, (Date.now()-firstDate.getTime())/2592000000) : null;
  const liveTpm   = (monthsActive && closed.length) ? +(closed.length/monthsActive).toFixed(1) : null;

  const NEED10 = { sym:'?', col:'#5a5a6e', tip:'Need 10+ trades for reliable comparison' };
  const statusWR = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live >= BT.wr - 10) return { sym:'✓', col:'#00d084' };
    if (live >= BT.wr - 25) return { sym:'⚠', col:'#F7931A' };
    return { sym:'✗', col:'#ff4d6d' };
  };
  const statusAvgR = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live >= BT.avgR - 0.1) return { sym:'✓', col:'#00d084' };
    if (live >= BT.avgR - 0.2) return { sym:'⚠', col:'#F7931A' };
    return { sym:'✗', col:'#ff4d6d' };
  };
  const statusTpm = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live >= BT.tpm * 0.5 && live <= BT.tpm * 1.5) return { sym:'✓', col:'#00d084' };
    return { sym:'⚠', col:'#F7931A' };
  };
  const statusDD = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live > BT.maxDD + 5) return { sym:'✗', col:'#ff4d6d' };
    return { sym:'✓', col:'#00d084' };
  };

  const mono = { fontFamily:"'JetBrains Mono',monospace" };

  return (
    <div style={perfStyles.wrap}>

      {/* Progress bar — paper/live mode with < 30 trades */}
      {viewMode !== 'backtest' && closed.length < 30 && (() => {
        const pct = Math.round(closed.length / 30 * 100);
        const barColor = pct >= 66 ? '#F7931A' : pct >= 33 ? '#F7931A' : '#ff4d6d';
        const barColorEnd = pct >= 100 ? '#00d084' : pct >= 66 ? '#F7931A' : pct >= 33 ? '#F7931A' : '#ff4d6d';
        // Estimate completion date
        let estLabel = '';
        const BT_TPM = 2.5;
        let tpm = BT_TPM;
        if (closed.length >= 2) {
          const sorted = [...closed].sort((a,b)=>(a.timestamp_exit||'').localeCompare(b.timestamp_exit||''));
          const first = new Date(sorted[0].timestamp_exit||'');
          const last  = new Date(sorted[sorted.length-1].timestamp_exit||'');
          const spanMs = last - first;
          if (spanMs > 7 * 86400000) { // at least 1 week of data
            tpm = closed.length / (spanMs / 2592000000);
          }
        }
        const remaining = 30 - closed.length;
        const monthsLeft = remaining / Math.max(tpm, 0.1);
        const estDate = new Date();
        estDate.setMonth(estDate.getMonth() + Math.round(monthsLeft));
        const estStr = estDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        const paceNote = (tpm < BT_TPM * 0.7) ? 'below backtest avg' : '';
        estLabel = `Est. ~${estStr} at current pace${paceNote ? ' · ' + paceNote : ''}`;
        return (
          <div style={{background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'14px 20px', marginBottom:14}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
              <span style={{fontSize:12, fontWeight:600, color:'#ece9e2'}}>Paper validation</span>
              <span style={{fontSize:11, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace"}}>{closed.length}/30 trades · {pct}%</span>
            </div>
            <div style={{height:6, background:'#1a1a22', borderRadius:3, overflow:'hidden'}}>
              <div style={{height:'100%', width:`${pct}%`,
                background: pct >= 100 ? '#00d084' : `linear-gradient(90deg,${barColor},${barColorEnd})`,
                borderRadius:3, transition:'width 0.3s'}}/>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6}}>
              <span style={{fontSize:11, color:'#3e3e52'}}>
                {30 - closed.length} more trades until comparisons are statistically reliable
              </span>
              <span style={{fontSize:11, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace"}}>{estLabel}</span>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22}}>
        <div>
          <div style={perfStyles.pageTitle}>Performance</div>
          <div style={{fontSize:12, color:'#3e3e52', marginTop:4}}>
            {closed.length} closed trades · {viewMode} mode
          </div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          <button onClick={() => {
            const rows = [['Year','Month','Return%','PnL_USD','Trades','Net_R','MaxWin_R','MaxLoss_R']];
            monthly.forEach(m => {
              const [y, mo] = m.ym.split('-');
              rows.push([y, MONTHS[parseInt(mo)-1], m.pct, m.pnl, m.trades, m.r, m.maxWin, m.maxLoss]);
            });
            const csv = rows.map(r => r.join(',')).join('\n');
            const blob = new Blob([csv], {type:'text/csv'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href=url; a.download='performance.csv'; a.click();
            URL.revokeObjectURL(url);
          }} style={{padding:'7px 14px', borderRadius:7, border:'1px solid #2a2a38', background:'#111116',
            color:'#5a5a6e', fontSize:11, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif",
            fontWeight:600, letterSpacing:'0.3px'}}>
            ↓ Export CSV
          </button>
          {viewMode !== undefined && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} dateRange={dateRange} />}
        </div>
      </div>

      {/* 1 — Monthly Returns Table */}
      <div style={perfStyles.card}>
        <div style={perfStyles.cardTitle}>
          Monthly Returns
          <span style={perfStyles.cardSub}>% gain/loss on starting balance each month</span>
        </div>
        {years.length > 0 ? (
          <div style={{overflowX:'auto', marginTop:14}}>
            <table style={{width:'100%', borderCollapse:'collapse', ...mono, fontSize:13}}>
              <thead>
                <tr>
                  <th style={perfStyles.th}>Year</th>
                  {MONTHS.map(m => <th key={m} style={perfStyles.th}>{m}</th>)}
                  <th style={perfStyles.th}>Full Year</th>
                </tr>
              </thead>
              <tbody>
                {years.map(y => {
                  const yearPct = Object.values(byYear[y]).reduce((s,m) => s + m.pct, 0);
                  return (
                    <tr key={y}>
                      <td style={{...perfStyles.td, fontWeight:700, color:'#ece9e2'}}>{y}</td>
                      {MONTHS.map((_, mi) => {
                        const cell = byYear[y][mi];
                        const pct  = cell?.pct ?? null;
                        const bg   = pct == null ? 'transparent'
                          : pct > 0 ? `rgba(0,208,132,${Math.min(0.6, Math.abs(pct)/10*0.5+0.08)})`
                          : `rgba(255,77,109,${Math.min(0.6, Math.abs(pct)/10*0.5+0.08)})`;
                        const isHov = hovCell?.y === y && hovCell?.mi === mi && cell;
                        return (
                          <td key={mi}
                            onMouseEnter={() => cell && setHovCell({y, mi})}
                            onMouseLeave={() => setHovCell(null)}
                            style={{...perfStyles.td, background:bg, position:'relative',
                              color: pct == null ? '#2a2a38' : pct > 0 ? '#00d084' : '#ff4d6d',
                              fontWeight: pct != null ? 700 : 400, textAlign:'right', cursor: cell ? 'default' : 'default'}}>
                            {pct == null ? '—' : `${pct>0?'+':''}${pct.toFixed(1)}%`}
                            {isHov && (
                              <div style={{position:'absolute', bottom:'calc(100% + 4px)', left:'50%', transform:'translateX(-50%)',
                                background:'#17171e', border:'1px solid #2a2a38', borderRadius:6, padding:'8px 11px',
                                fontSize:11, color:'#ece9e2', whiteSpace:'nowrap', zIndex:200,
                                boxShadow:'0 4px 16px rgba(0,0,0,0.6)', fontFamily:"'JetBrains Mono',monospace", textAlign:'left'}}>
                                <div style={{fontWeight:700, marginBottom:4, color:'#ece9e2'}}>{MONTHS[mi]} {y}</div>
                                <div style={{color: pct>0?'#00d084':'#ff4d6d'}}>{pct>0?'+':''}{pct.toFixed(2)}%</div>
                                <div style={{color:'#5a5a6e'}}>{cell.trades} trade{cell.trades!==1?'s':''}</div>
                                <div style={{color:'#00d084'}}>Best: +{cell.maxWin}R</div>
                                <div style={{color:'#ff4d6d'}}>Worst: {cell.maxLoss}R</div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td style={{...perfStyles.td, fontWeight:700, textAlign:'right',
                        color: yearPct >= 0 ? '#00d084' : '#ff4d6d'}}>
                        {yearPct >= 0 ? '+' : ''}{yearPct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{padding:'24px 0', textAlign:'center', color:'#3e3e52', fontSize:12}}>
            Monthly returns populate after first closed trade
          </div>
        )}
      </div>

      {/* 2 + 3 — Charts side-by-side */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14}}>

        {/* Rolling WR */}
        <div style={perfStyles.card}>
          <div style={perfStyles.cardTitle}>
            30-Day Rolling Win Rate
            <span style={perfStyles.cardSub}>vs {BT.wr}% backtest target</span>
          </div>
          <div style={{marginTop:12}}>
            <RollingWRChart points={rollingWR} btWR={BT.wr} tradeCount={closed.length} />
          </div>
          <div style={{display:'flex', gap:14, marginTop:10, fontSize:10, color:'#3e3e52'}}>
            <span><span style={{color:'#00d084', fontWeight:700}}>━</span> Rolling WR</span>
            <span><span style={{color:'#F7931A', fontWeight:700}}>- -</span> Backtest {BT.wr}%</span>
          </div>
        </div>

        {/* Drawdown */}
        <div style={perfStyles.card}>
          <div style={perfStyles.cardTitle}>
            Drawdown from Peak
            <span style={perfStyles.cardSub}>-10% T2 pause · -15% circuit breaker</span>
          </div>
          <div style={{marginTop:12}}>
            <DrawdownChart points={ddSeries} tradeCount={closed.length} />
          </div>
          <div style={{display:'flex', gap:14, marginTop:10, fontSize:10, color:'#3e3e52'}}>
            <span><span style={{color:'#F7931A'}}>- -</span> -10% (Tier 2 pause)</span>
            <span><span style={{color:'#ff4d6d'}}>- -</span> -15% (Circuit breaker)</span>
          </div>
        </div>
      </div>

      {/* 4 — Strategy Leaderboard (this month) */}
      <div style={perfStyles.card}>
        <div style={perfStyles.cardTitle}>
          Strategy Leaderboard — {leaderMonthLabel}
          {viewMode === 'backtest' && <span style={{fontSize:10, color:'#38bdf8', marginLeft:6}}>BT</span>}
          <span style={perfStyles.cardSub}>{monthT.length} trades</span>
        </div>
        {leaderRows.length > 0 ? (
          <div style={{overflowX:'auto', marginTop:14}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:11, ...mono}}>
              <thead>
                <tr>
                  {['Strategy','W · L','WR','Avg R','Net R'].map(h =>
                    <th key={h} style={perfStyles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {leaderRows.map((row, i) => {
                  const wr = row.total > 0 ? Math.round(row.w/row.total*100) : 0;
                  const name = (window.STRAT_NAMES||{})[row.type?.toLowerCase()] || row.type;
                  return (
                    <tr key={row.type} style={{borderBottom:'1px solid #15151d'}}>
                      <td style={{...perfStyles.td, color:'#F7931A', fontWeight:600}}>{name}</td>
                      <td style={{...perfStyles.td, fontFamily:"'JetBrains Mono',monospace"}}>
                        <span style={{color:'#00d084'}}>{row.w}W</span>
                        <span style={{color:'#3e3e52'}}> · </span>
                        <span style={{color:'#ff4d6d'}}>{row.l}L</span>
                      </td>
                      <td style={{...perfStyles.td, color: wr>=50?'#00d084':'#ff4d6d'}}>{wr}%</td>
                      <td style={{...perfStyles.td, color: row.avgR>=0?'#00d084':'#ff4d6d'}}>{row.avgR>=0?'+':''}{row.avgR.toFixed(2)}R</td>
                      <td style={{...perfStyles.td, fontWeight:700, color: row.r>=0?'#00d084':'#ff4d6d'}}>{row.r>=0?'+':''}{row.r.toFixed(2)}R</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{padding:'24px 0', textAlign:'center', color:'#3e3e52', fontSize:12}}>
            {viewMode === 'backtest'
              ? 'No backtest trades found. Try a different date range.'
              : 'No closed trades this month — switch to Backtest mode to explore historical data.'}
          </div>
        )}
      </div>

      {/* 5 — Live vs Backtest comparison */}
      {viewMode === 'backtest' ? (
        <div style={perfStyles.card}>
          <div style={perfStyles.cardTitle}>Live vs Backtest (v9)</div>
          <div style={{padding:'20px 0', textAlign:'center', color:'#3e3e52', fontSize:12}}>
            Switch to Live or Paper trading to compare performance vs the backtest model.
          </div>
        </div>
      ) : null}
      {viewMode !== 'backtest' && <div style={perfStyles.card}>
        <div style={perfStyles.cardTitle}>
          Live vs Backtest (v9)
        </div>
        {closed.length < 5 && (
          <div style={{background:'rgba(247,147,26,0.06)', border:'1px solid rgba(247,147,26,0.15)', borderRadius:7,
            padding:'9px 14px', marginTop:10, fontSize:11, color:'#F7931A', display:'flex', gap:8, alignItems:'center'}}>
            <span>⚠</span>
            <span>Live sample: {closed.length} trades — comparisons are reliable after 30+ trades</span>
          </div>
        )}
        <div style={{marginTop:14, overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
            <thead>
              <tr>
                {['Metric','Backtest (v9)','Live / Paper','Status'].map(h =>
                  <th key={h} style={perfStyles.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                { label:'Win Rate',       bt:`${BT.wr}%`,    live: liveWR   != null ? `${liveWR}%`         : '—', st: statusWR(liveWR) },
                { label:'Avg R / trade',  bt:`+${BT.avgR}R`, live: liveAvgR != null ? `${liveAvgR>=0?'+':''}${liveAvgR.toFixed(2)}R` : '—', st: statusAvgR(liveAvgR) },
                { label:'Trades / month', bt:`~${BT.tpm}`,   live: liveTpm  != null ? `${liveTpm}`          : '—', st: statusTpm(liveTpm) },
                { label:'Max Drawdown',   bt:`-${BT.maxDD}%`,
                  live: liveMaxDD!=null ? `-${liveMaxDD.toFixed(1)}%` : '—',
                  st: statusDD(liveMaxDD) },
              ].map(row => (
                <tr key={row.label} style={{borderBottom:'1px solid #15151d'}}>
                  <td style={{...perfStyles.td, color:'#5a5a6e'}}>{row.label}</td>
                  <td style={{...perfStyles.td, ...mono, color:'#ece9e2', fontWeight:600}}>{row.bt}</td>
                  <td style={{...perfStyles.td, ...mono, fontWeight:700,
                    color: row.live==='—'?'#3e3e52':row.st.col}}>{row.live}</td>
                  <td title={row.st.tip||''} style={{...perfStyles.td, fontSize:16, color:row.st.col, fontWeight:700, cursor:row.st.tip?'help':'default'}}>{row.st.sym}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:12, fontSize:10, color:'#2a2a38'}}>
          ✓ on target · ⚠ moderately off · ✗ significantly off · ? hover for details
        </div>
      </div>}

    </div>
  );
}

const perfStyles = {
  wrap:      { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  card:      { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 22px', marginBottom:14 },
  cardTitle: { fontSize:13, fontWeight:600, color:'#ece9e2' },
  cardSub:   { fontSize:11, color:'#3e3e52', fontWeight:400, marginLeft:8 },
  th:        { textAlign:'left', fontSize:10, color:'#3e3e52', fontWeight:600, padding:'9px 12px',
               letterSpacing:'0.4px', background:'#0d0d11', borderBottom:'1px solid #1a1a22', whiteSpace:'nowrap' },
  td:        { padding:'9px 12px', fontSize:13, color:'#ece9e2', verticalAlign:'middle', borderBottom:'1px solid #15151d' },
};

Object.assign(window, { Performance });
