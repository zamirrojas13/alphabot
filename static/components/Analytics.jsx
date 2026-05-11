
const AN_STRAT_NAMES = {
  't1c_d_sstar_short':           'Daily A · Failed Top',
  't2b_w_sweep_hi_short':        'Weekly A · Top Trap',
  't1a_w_fail_brkdn_long':       'Weekly A · Fake Crash Bounce',
  't1b_w_rsi_os_long':           'Weekly A · Deep Drop Bounce',
  't1d_h4_sweep_hi_short':       '4H B · Fake High Reversal',
  't1e_w_oversold_hammer_long':  'Weekly B · Dip Bounce',
  't2c_w_bull_engulf_long':      'Weekly B · Trend Resume',
  't3c_w_5bar_low_long':         'Weekly B · 5-Week Low',
  't3a_h1_fail_brkdn_long':      '1H C · Quick Bounce',
  't2a_d_hammer_long':           'Daily C · Daily Bounce',
  't3b_h4_sweep_hi_short_loose': '4H C · Top Reject',
  't1f_h4_willy_rev_short':      '4H A · Willy Exhaustion',
  't2d_h4_bear_div_short':       '4H B · Bear Divergence',
  't1g_h4_vol_surge_long':       '4H B · Vol Spike Bounce',
  't1h_h4_vol_surge_short':      '4H B · Vol Spike Rejection',
  'c3_w_engulf_long':            'Weekly · Bull Engulf',
  'c5_w_hammer_20w_low_long':    'Weekly · 20W Low Hammer',
};

function Analytics({ data, viewMode, setViewMode, dateRange }) {
  const { daily_pnl, hourly_stats, dow_stats, ev_by_setup, trades, stats } = data;
  const closed = trades.filter(t => !t.open && t.r_multiple !== null);

  // Calendar — group by month for readability
  const calDays = Object.entries(daily_pnl).sort(([a],[b]) => a.localeCompare(b));
  const maxAbs  = Math.max(...Object.values(daily_pnl).map(Math.abs), 1);
  const heatColor = v => {
    if (v === 0) return '#1a1a22';
    const intensity = Math.min(Math.abs(v) / maxAbs, 1);
    return v > 0
      ? `rgba(0,208,132,${0.15 + intensity * 0.75})`
      : `rgba(255,77,109,${0.15 + intensity * 0.75})`;
  };
  // Group calendar by month
  const byMonth = {};
  calDays.forEach(([date, val]) => {
    const m = date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push([date, val]);
  });
  const monthLabel = m => {
    try {
      return new Date(m + '-15').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch { return m; }
  };

  // Grade performance
  const gradeR = {};
  closed.forEach(t => {
    if (!gradeR[t.grade]) gradeR[t.grade] = [];
    gradeR[t.grade].push(t.r_multiple);
  });
  const gradeStats = Object.entries(gradeR).map(([g, rs]) => ({
    grade: g,
    avg: +(rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2),
    count: rs.length,
    wins: rs.filter(r=>r>0).length,
  }));

  const fmtUsd = n => Math.abs(n) >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : n.toFixed(2);

  return (
    <div style={anStyles.wrap}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22}}>
        <div>
          <div style={{...anStyles.pageTitle, marginBottom:0}}>Analytics</div>
          {viewMode === 'sim' && dateRange &&
            <div style={{fontSize:12, color:'#F7931A', marginTop:4}}>
              Backtest · $10k start · {dateRange.start.slice(0,4)}→{dateRange.end.slice(0,4)} · {data.trades?.length ?? 0} trades
            </div>}
        </div>
        {viewMode !== undefined && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} dateRange={dateRange} />}
      </div>

      {/* R explanation banner */}
      <div style={{background:'rgba(247,147,26,0.06)', border:'1px solid rgba(247,147,26,0.15)', borderRadius:8,
        padding:'9px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10}}>
        <span style={{fontSize:13, color:'#F7931A', fontWeight:700}}>What is R?</span>
        <span style={{fontSize:12, color:'#5a5a6e'}}>
          R = Risk Multiple. <span style={{color:'#ece9e2'}}>1R</span> = you made back exactly what you risked.&nbsp;
          <span style={{color:'#00d084'}}>+2R</span> = profit twice the risk.&nbsp;
          <span style={{color:'#ff4d6d'}}>−1R</span> = full stop-loss hit.&nbsp;
          A strategy needs avg R &gt; 0 to be profitable long-term.
        </span>
      </div>

      {/* Top KPIs */}
      {(() => {
        const hasTrades = closed.length > 0;
        const pnlVals   = Object.values(daily_pnl);
        const nonZero   = pnlVals.filter(v => v !== 0);
        const bestDay   = hasTrades && nonZero.length ? Math.max(...nonZero) : null;
        const worstDay  = hasTrades && nonZero.length ? Math.min(...nonZero) : null;
        const profitD   = pnlVals.filter(v=>v>0).length;
        const tradeD    = pnlVals.filter(v=>v!==0).length;
        const kpis = [
          { label:'Total R',     val: hasTrades ? `${stats.total_r>0?'+':''}${stats.total_r.toFixed(2)}R` : '—',
            sub: 'Sum of all risk multiples',
            col: hasTrades?(stats.total_r>0?'#00d084':'#ff4d6d'):'#3e3e52' },
          { label:'Avg R / trade', val: hasTrades ? `${stats.avg_r>0?'+':''}${stats.avg_r.toFixed(2)}R` : '—',
            sub: 'Expectancy per trade',
            col: hasTrades?(stats.avg_r>1?'#00d084':stats.avg_r>0?'#F7931A':'#ff4d6d'):'#3e3e52' },
          { label:'Win Rate',    val: hasTrades ? `${stats.win_rate}%` : '—',
            sub: `${stats.wins ?? 0}W · ${stats.losses ?? 0}L`,
            col: hasTrades?'#ece9e2':'#3e3e52' },
          { label:'Best day',    val: bestDay !== null ? `+$${fmtUsd(bestDay)}` : '—',
            sub: 'Single best trading day',
            col: hasTrades?'#00d084':'#3e3e52' },
          { label:'Worst day',   val: worstDay !== null ? `-$${fmtUsd(Math.abs(worstDay))}` : '—',
            sub: 'Single worst trading day',
            col: hasTrades?'#ff4d6d':'#3e3e52' },
          { label:'Profit days', val: hasTrades ? `${profitD}/${tradeD}` : '—',
            sub: 'Days with a winning close',
            col: hasTrades?'#F7931A':'#3e3e52' },
        ];
        return (
          <div style={anStyles.kpiRow}>
            {kpis.map(k => (
              <div key={k.label} style={anStyles.kpiCard}>
                <div style={anStyles.kpiLabel}>{k.label}</div>
                <div style={{...anStyles.kpiVal, color:k.col}}>{k.val}</div>
                {k.sub && <div style={{fontSize:10, color:'#2a2a38', marginTop:5}}>{k.sub}</div>}
              </div>
            ))}
          </div>
        );
      })()}

      <div style={anStyles.twoCol}>
        {/* P&L Calendar — grouped by month */}
        <div style={anStyles.card}>
          <div style={anStyles.cardTitle}>
            P&L Calendar
            <span style={anStyles.cardSub}>Last {Object.keys(byMonth).length} months · {calDays.length} active days</span>
          </div>
          <div style={{marginTop:14, display:'flex', flexDirection:'column', gap:14}}>
            {Object.entries(byMonth).map(([month, days]) => (
              <div key={month}>
                <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', marginBottom:6, textTransform:'uppercase', fontWeight:600}}>
                  {monthLabel(month)}
                </div>
                <div style={{display:'flex', flexWrap:'wrap', gap:3}}>
                  {days.map(([date, val]) => (
                    <div key={date}
                      title={`${date}: ${val >= 0 ? '+':''}\$${val.toFixed(2)}`}
                      style={{ width:28, height:28, borderRadius:5, background:heatColor(val),
                        border:'1px solid rgba(255,255,255,0.04)', cursor:'default',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{fontSize:9, color:'rgba(255,255,255,0.5)', fontFamily:"'JetBrains Mono',monospace"}}>
                        {new Date(date+'T12:00:00').getDate()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex', gap:12, marginTop:14, alignItems:'center'}}>
            {[['rgba(0,208,132,0.8)','Profit'],['rgba(255,77,109,0.8)','Loss'],['#1a1a22','No trade']].map(([c,l]) => (
              <div key={l} style={{display:'flex', gap:4, alignItems:'center'}}>
                <div style={{width:12,height:12,borderRadius:2,background:c}}></div>
                <span style={{fontSize:11,color:'#3e3e52'}}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Expected Value by setup */}
        <div style={anStyles.card}>
          <div style={anStyles.cardTitle}>
            Expected Value by Setup
            <span style={anStyles.cardSub}>EV = (WR × avg win R) − (1−WR) × avg loss R</span>
          </div>
          {ev_by_setup.length > 0 ? (
            <div style={{marginTop:14, display:'flex', flexDirection:'column', gap:14}}>
              {ev_by_setup.map(s => {
                const name = AN_STRAT_NAMES[s.type?.toLowerCase()] || s.type;
                const isLong = s.type?.toLowerCase().endsWith('long');
                return (
                  <div key={s.type}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:5, alignItems:'center'}}>
                      <div style={{display:'flex', gap:8, alignItems:'center', flex:1, minWidth:0}}>
                        <span style={{fontSize:12, fontWeight:700, color:'#ece9e2', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{name}</span>
                        <span style={{fontSize:10, padding:'1px 6px', borderRadius:3, flexShrink:0,
                          background: isLong?'rgba(0,208,132,0.1)':'rgba(255,77,109,0.1)',
                          color: isLong?'#00d084':'#ff4d6d'}}>
                          {isLong ? '▲ Long' : '▼ Short'}
                        </span>
                        <span style={{fontSize:10, color:'#3e3e52', flexShrink:0}}>{s.total} trades · {(s.wr*100).toFixed(0)}% WR</span>
                      </div>
                      <span style={{fontSize:14, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                        color: s.ev>0?'#00d084':'#ff4d6d', flexShrink:0, marginLeft:8}}>
                        EV: {s.ev>0?'+':''}{s.ev}R
                      </span>
                    </div>
                    <div style={{display:'flex', gap:12, marginBottom:5}}>
                      <span style={{fontSize:11, color:'#5a5a6e'}}>
                        Avg win: <span style={{color:'#00d084'}}>+{s.avgW}R</span>
                      </span>
                      <span style={{fontSize:11, color:'#5a5a6e'}}>
                        Avg loss: <span style={{color: s.avgL > 0 ? '#ff4d6d' : '#3e3e52'}}>
                          {s.avgL > 0 ? `-${s.avgL}R` : '—'}
                        </span>
                      </span>
                      {s.total < 10 && (
                        <span style={{fontSize:10, color:'#F7931A', padding:'1px 6px', borderRadius:3, background:'rgba(247,147,26,0.1)'}}>
                          ⚠ Low sample
                        </span>
                      )}
                    </div>
                    <div style={{height:5, background:'#1a1a22', borderRadius:3, overflow:'hidden'}}>
                      <div style={{width:`${s.wr*100}%`, height:'100%',
                        background: s.ev>0.5?'#00d084':s.ev>0?'#F7931A':'#ff4d6d', borderRadius:3}}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:100, gap:6}}>
              <span style={{fontSize:20, opacity:0.1}}>◉</span>
              <span style={{fontSize:12, color:'#3e3e52'}}>Will populate after first closed trade</span>
            </div>
          )}
        </div>
      </div>

      <div style={anStyles.twoCol}>
        {/* Time of day */}
        <div style={anStyles.card}>
          <div style={anStyles.cardTitle}>Win Rate by H4 Bar <span style={anStyles.cardSub}>UTC open time</span></div>
          {closed.length > 0 ? (
            <div style={{marginTop:16, display:'flex', gap:8, alignItems:'flex-end', height:100}}>
              {hourly_stats.map(h => {
                const total = h.wins + h.losses;
                const wr = total ? h.wins/total : 0;
                const barH = Math.max(8, wr * 90);
                const col = wr >= 0.6 ? '#00d084' : wr >= 0.4 ? '#F7931A' : '#ff4d6d';
                return (
                  <div key={h.hour} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
                    <span style={{fontSize:10, color: col, fontWeight:700}}>{total ? `${(wr*100).toFixed(0)}%` : '—'}</span>
                    <div style={{width:'100%', height: total ? barH : 4, background: total ? col : '#1a1a22',
                      borderRadius:'3px 3px 0 0', opacity: total ? 0.85 : 0.3}}></div>
                    <span style={{fontSize:10, color:'#3e3e52', fontFamily:"'JetBrains Mono',monospace"}}>{h.label}</span>
                    <span style={{fontSize:9, color:'#2a2a38'}}>{total ? `${h.wins}W ${h.losses}L` : 'no data'}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:100, gap:6}}>
              <span style={{fontSize:20, opacity:0.1}}>◈</span>
              <span style={{fontSize:12, color:'#3e3e52'}}>Will populate after first closed trade</span>
            </div>
          )}
        </div>

        {/* Day of week */}
        <div style={anStyles.card}>
          <div style={anStyles.cardTitle}>Performance by Day of Week</div>
          {closed.length > 0 ? (
            <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:8}}>
              {dow_stats.map(d => {
                const total = d.wins + d.losses;
                const wr = total ? d.wins/total : 0;
                const hasData = total > 0;
                return (
                  <div key={d.day} style={{display:'flex', gap:10, alignItems:'center'}}>
                    <span style={{fontSize:12, color:'#5a5a6e', width:32, flexShrink:0}}>{d.day}</span>
                    <div style={{flex:1, height:6, background:'#1a1a22', borderRadius:3, overflow:'hidden'}}>
                      <div style={{width:`${wr*100}%`, height:'100%',
                        background: wr>=0.6?'#00d084':wr>=0.4?'#F7931A':'#ff4d6d', borderRadius:3}}></div>
                    </div>
                    <span style={{fontSize:11, fontFamily:"'JetBrains Mono',monospace",
                      color: hasData?'#5a5a6e':'#2a2a38', width:36}}>
                      {hasData ? `${(wr*100).toFixed(0)}%` : '—'}
                    </span>
                    <span style={{fontSize:11, fontFamily:"'JetBrains Mono',monospace",
                      color: !hasData?'#2a2a38':d.total_r>0?'#00d084':'#ff4d6d', width:50, textAlign:'right'}}>
                      {hasData ? `${d.total_r>0?'+':''}${d.total_r.toFixed(2)}R` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:100, gap:6}}>
              <span style={{fontSize:20, opacity:0.1}}>◬</span>
              <span style={{fontSize:12, color:'#3e3e52'}}>Will populate after first closed trade</span>
            </div>
          )}
        </div>
      </div>

      {/* Grade performance */}
      <div style={anStyles.card}>
        <div style={anStyles.cardTitle}>Quality Grade vs Actual R Achieved
          <span style={anStyles.cardSub}>Does A+ actually outperform B in practice?</span>
        </div>
        {gradeStats.length > 0 ? (
          <div style={{display:'flex', gap:0, marginTop:14}}>
            {gradeStats.map((g, i) => (
              <div key={g.grade} style={{flex:1, padding:'0 20px', borderRight: i<gradeStats.length-1?'1px solid #1a1a22':'none'}}>
                <div style={{marginBottom:8}}><GradeBadge grade={g.grade} /></div>
                <div style={{fontSize:22, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                  color: g.avg>0?'#00d084':'#ff4d6d', marginBottom:4}}>
                  {g.avg>0?'+':''}{g.avg}R
                </div>
                <div style={{fontSize:11, color:'#3e3e52'}}>avg per trade</div>
                <div style={{marginTop:8, fontSize:11, color:'#5a5a6e'}}>{g.wins}/{g.count} wins</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:80, gap:6}}>
            <span style={{fontSize:12, color:'#3e3e52'}}>Will populate after first closed trade</span>
            <span style={{fontSize:11, color:'#2a2a38'}}>Shows whether A+ setups actually beat B setups in real trading</span>
          </div>
        )}
      </div>
    </div>
  );
}

const anStyles = {
  wrap: { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  kpiRow: { display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:14 },
  kpiCard: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'14px 16px' },
  kpiLabel: { fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:7 },
  kpiVal: { fontSize:18, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" },
  twoCol: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 },
  card: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 22px', marginBottom:14 },
  cardTitle: { fontSize:13, fontWeight:600, color:'#ece9e2' },
  cardSub: { fontSize:11, color:'#3e3e52', fontWeight:400, marginLeft:8 },
};

Object.assign(window, { Analytics });
