
function GaugeArc({ pct, color, label, sub }) {
  const R = 60, cx = 75, cy = 75;
  const startAngle = -210, endAngle = 30;
  const totalArc = endAngle - startAngle;
  const filled = startAngle + totalArc * Math.min(pct, 1);
  const toRad = d => (d * Math.PI) / 180;
  const arcPath = (a1, a2, r) => {
    const x1 = cx + r * Math.cos(toRad(a1));
    const y1 = cy + r * Math.sin(toRad(a1));
    const x2 = cx + r * Math.cos(toRad(a2));
    const y2 = cy + r * Math.sin(toRad(a2));
    const large = (a2 - a1) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
      <svg width={150} height={100} viewBox="0 0 150 100">
        <path d={arcPath(startAngle, endAngle, R)} fill="none" stroke="#1f1f28" strokeWidth={10} strokeLinecap="round" />
        <path d={arcPath(startAngle, filled, R)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 4px ${color}88)`}} />
        <text x={cx} y={cy+8} textAnchor="middle" fontSize={16} fontWeight={700} fill={color} fontFamily="'JetBrains Mono',monospace">{label}</text>
        <text x={cx} y={cy+22} textAnchor="middle" fontSize={9} fill="#3e3e52" fontFamily="'Space Grotesk',sans-serif">{sub}</text>
      </svg>
    </div>
  );
}

// Map backtest CSV strategy IDs → friendly names
const RM_STRAT_NAMES = {
  't1a_w_fail_brkdn_long':       'Weekly A · Fake Crash Bounce (Buy)',
  't1b_w_rsi_os_long':           'Weekly A · Deep Drop Bounce (Buy)',
  't1c_d_sstar_short':           'Daily A · Failed Top (Sell)',
  't1d_h4_sweep_hi_short':       '4-Hour B · Fake High Reversal (Sell)',
  't1e_w_oversold_hammer_long':  'Weekly B · Trend Dip Bounce (Buy)',
  't1f_h4_willy_rev_short':      '4-Hour A · Willy Exhaustion (Sell)',
  't1g_h4_vol_surge_long':       '4-Hour B · Volume Spike Bounce (Buy)',
  't1h_h4_vol_surge_short':      '4-Hour B · Volume Spike Rejection (Sell)',
  't2a_d_hammer_long':           'Daily C · Daily Bounce (Buy)',
  't2b_w_sweep_hi_short':        'Weekly A · Weekly Top Trap (Sell)',
  't2c_w_bull_engulf_long':      'Weekly B · Trend Resume (Buy)',
  't2d_h4_bear_div_short':       '4-Hour B · Bearish Divergence (Sell)',
  't3a_h1_fail_brkdn_long':      'Hourly C · Quick Bounce (Buy)',
  't3b_h4_sweep_hi_short_loose': '4-Hour C · Quick Top Reject (Sell)',
  't3c_w_5bar_low_long':         'Weekly B · Multi-Week Low (Buy)',
  'c3_w_engulf_long':            'Weekly · Bull Engulf (Buy)',        // legacy CSV name
  'c5_w_hammer_20w_low_long':    'Weekly · 20W Low Hammer (Buy)',     // legacy CSV name
};

// Tier of each strategy (for filtering)
const RM_STRAT_TIER = {
  't1a_w_fail_brkdn_long':1,'t1b_w_rsi_os_long':1,'t1c_d_sstar_short':1,
  't1d_h4_sweep_hi_short':1,'t1e_w_oversold_hammer_long':1,'t1f_h4_willy_rev_short':1,
  't1g_h4_vol_surge_long':1,'t1h_h4_vol_surge_short':1,
  't2a_d_hammer_long':2,'t2b_w_sweep_hi_short':2,'t2c_w_bull_engulf_long':2,'t2d_h4_bear_div_short':2,
  't3a_h1_fail_brkdn_long':3,'t3b_h4_sweep_hi_short_loose':3,'t3c_w_5bar_low_long':3,
  'c3_w_engulf_long':2,'c5_w_hammer_20w_low_long':2,
};

function RiskMonitor({ data, viewMode, setViewMode, dateRange }) {
  const { account, position, bot_state, trades, stats, session_dd, ev_by_setup, config } = data;
  const closed = trades.filter(t => !t.open && t.r_multiple !== null);
  const [hideWeak, setHideWeak] = React.useState(false);

  // Drawdown calc — walk trades chronologically (oldest first) from starting balance
  const startBal = account.account_size;
  let peak = startBal, bal = startBal, maxDD = 0;
  [...closed].reverse().forEach(t => {   // closed is newest-first; reverse = oldest-first
    bal += (t.pnl_net_usd || 0);
    if (bal > peak) peak = bal;
    const dd = peak > 0 ? (bal - peak) / peak * 100 : 0;
    if (dd < maxDD) maxDD = dd;
  });
  // If no trades, peak = current equity
  if (closed.length === 0) peak = account.equity;
  const currentDD = peak > 0 ? ((account.equity - peak) / peak * 100) : 0;
  const ddPct = Math.min(Math.abs(currentDD) / 20, 1); // 20% = max gauge

  // Open risk %
  const openRiskUsd  = bot_state.active_trade?.max_risk_usd || 0;
  const openRiskPct  = account.equity > 0 ? (openRiskUsd / account.equity * 100) : 0;
  const tierRiskPct  = config.TIER_RISK_PCT?.[bot_state.active_trade?.tier || 3] ?? 0;

  // Session stats (today)
  const today = new Date().toISOString().slice(0,10);
  const todayTrades = closed.filter(t => t.timestamp_exit?.startsWith(today));

  // Consecutive stats
  let streak = 0, streakType = null;
  for (const t of [...closed].reverse()) {
    const isWin = t.r_multiple > 0;
    if (streakType === null) { streakType = isWin; streak = 1; }
    else if (isWin === streakType) { streak++; }
    else break;
  }

  const ddColor   = Math.abs(currentDD) > 10 ? '#ff4d6d' : Math.abs(currentDD) > 5 ? '#F7931A' : '#00d084';
  const riskColor = openRiskPct > 5 ? '#ff4d6d' : openRiskPct > 3 ? '#F7931A' : '#00d084';

  // T3-impact analysis
  const evWithT3    = ev_by_setup;
  const evWithoutT3 = ev_by_setup.filter(s => (RM_STRAT_TIER[s.type.toLowerCase()] || 2) < 3);
  const calcOverall = (rows) => {
    const all = rows.reduce((a,s) => ({w:a.w+s.wr*s.total, n:a.n+s.total, r:a.r+s.ev*s.total}), {w:0,n:0,r:0});
    return all.n > 0 ? {wr: Math.round(all.w/all.n*100), ev: (all.r/all.n).toFixed(2), n: all.n} : {wr:0,ev:'0',n:0};
  };
  const withT3    = calcOverall(evWithT3);
  const withoutT3 = calcOverall(evWithoutT3);
  const displayedEV = hideWeak ? evWithoutT3 : evWithT3;

  return (
    <div style={rmStyles.wrap}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22}}>
        <div>
          <div style={{...rmStyles.pageTitle, marginBottom:0}}>Risk Monitor</div>
          {viewMode === 'sim' && dateRange &&
            <div style={{fontSize:12, color:'#F7931A', marginTop:4}}>
              Backtest · max DD {maxDD.toFixed(1)}% · {dateRange.start.slice(0,4)}→{dateRange.end.slice(0,4)}
            </div>}
        </div>
        {viewMode !== undefined && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} dateRange={dateRange} />}
      </div>

      {/* ── T3 Strategy Impact Callout ── */}
      {closed.length > 0 && (() => {
        const t3trades = ev_by_setup.filter(s => (RM_STRAT_TIER[s.type.toLowerCase()]||2)===3)
                          .reduce((a,s)=>a+s.total,0);
        const t3pct = Math.round(t3trades/closed.length*100);
        if (t3pct < 30) return null;
        return (
          <div style={{marginBottom:14, padding:'14px 18px', borderRadius:10,
            background:'rgba(247,147,26,0.07)', border:'1px solid rgba(247,147,26,0.25)'}}>
            <div style={{fontSize:13, fontWeight:700, color:'#F7931A', marginBottom:6}}>
              ⚠️ T3 Strategies are masking your edge
            </div>
            <div style={{fontSize:12, color:'#5a5a6e', lineHeight:1.7}}>
              <b style={{color:'#ece9e2'}}>Tier-3 trades = {t3trades}/{closed.length} ({t3pct}%)</b> of all trades, yet their win rate ({
                Math.round(ev_by_setup.filter(s=>(RM_STRAT_TIER[s.type.toLowerCase()]||2)===3)
                  .reduce((a,s)=>a+s.wr*s.total,0) /
                  Math.max(1,t3trades)*100)
              }%) drags the overall number down. &nbsp;
              <b style={{color:'#ece9e2'}}>Without T3:</b> win rate would be{' '}
              <span style={{color:'#00d084', fontWeight:700}}>{withoutT3.wr}%</span>{' '}
              on {withoutT3.n} trades at{' '}
              <span style={{color:'#00d084', fontWeight:700}}>+{withoutT3.ev}R EV</span>.
            </div>
          </div>
        );
      })()}

      {/* Gauges */}
      <div style={rmStyles.gaugeRow}>
        <div style={rmStyles.gaugeCard}>
          <div style={rmStyles.cardTitle}>Drawdown from Peak</div>
          <GaugeArc pct={ddPct} color={ddColor} label={`${currentDD < 0 ? '-' : ''}${Math.abs(currentDD).toFixed(1)}%`} sub="current DD" />
          <div style={rmStyles.gaugeInfo}>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Peak equity</span><span style={rmStyles.gVal}>${peak.toFixed(2)}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Current equity</span><span style={rmStyles.gVal}>${account.equity.toFixed(2)}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Max DD (all time)</span><span style={{...rmStyles.gVal, color:'#ff4d6d'}}>{maxDD.toFixed(2)}%</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Loss streak</span><span style={{...rmStyles.gVal, color: bot_state.loss_streak>=2?'#ff4d6d':'#5a5a6e'}}>{bot_state.loss_streak}/3</span></div>
          </div>
        </div>

        <div style={rmStyles.gaugeCard}>
          <div style={rmStyles.cardTitle}>Open Risk</div>
          <GaugeArc pct={openRiskPct/8} color={riskColor} label={`${openRiskPct.toFixed(1)}%`} sub="of equity" />
          <div style={rmStyles.gaugeInfo}>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Risk $</span><span style={rmStyles.gVal}>${openRiskUsd}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Equity</span><span style={rmStyles.gVal}>${account.equity.toFixed(2)}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Tier</span><span style={rmStyles.gVal}>{bot_state.active_trade ? `T${bot_state.active_trade.tier}` : 'No trade'}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Tier risk %</span><span style={rmStyles.gVal}>{tierRiskPct.toFixed(1)}%</span></div>
          </div>
        </div>

        <div style={rmStyles.gaugeCard}>
          <div style={rmStyles.cardTitle}>Win Rate</div>
          {closed.length === 0 ? (
            <div style={{padding:'24px 0', textAlign:'center', color:'#2a2a38', fontSize:12}}>No closed trades yet</div>
          ) : (
            <GaugeArc pct={(stats.win_rate||0)/100} color={(stats.win_rate||0)>=50?'#00d084':(stats.win_rate||0)>=40?'#F7931A':'#ff4d6d'} label={`${stats.win_rate??0}%`} sub="all time" />
          )}
          <div style={rmStyles.gaugeInfo}>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Wins</span><span style={{...rmStyles.gVal,color:'#00d084'}}>{stats.wins ?? 0}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Losses</span><span style={{...rmStyles.gVal,color:'#ff4d6d'}}>{stats.losses ?? 0}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Streak</span><span style={{...rmStyles.gVal, color: closed.length===0?'#3e3e52':streakType?'#00d084':'#ff4d6d'}}>{closed.length===0 ? '—' : `${streak} ${streakType?'wins':'losses'}`}</span></div>
            <div style={rmStyles.gRow}><span style={rmStyles.gLbl}>Avg R</span><span style={{...rmStyles.gVal,color:closed.length===0?'#3e3e52':(stats.avg_r||0)>0?'#00d084':'#ff4d6d'}}>{closed.length===0 ? '—' : `${(stats.avg_r||0)>0?'+':''}${parseFloat(stats.avg_r||0).toFixed(2)}R`}</span></div>
          </div>
        </div>

        <div style={rmStyles.gaugeCard}>
          <div style={rmStyles.cardTitle}>Tier Restriction</div>
          <div style={{padding:'12px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:10}}>
            <div style={{width:60, height:60, borderRadius:'50%', border:`3px solid ${bot_state.tier_restricted?'#ff4d6d':'#00d084'}`,
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700,
              color:bot_state.tier_restricted?'#ff4d6d':'#00d084', letterSpacing:'0.5px',
              boxShadow:`0 0 16px ${bot_state.tier_restricted?'#ff4d6d44':'#00d08444'}`}}>
              {bot_state.tier_restricted ? <><span>T1</span><span>ONLY</span></> : <><span>ALL</span><span>TIERS</span></>}
            </div>
          </div>
          <div style={rmStyles.gaugeInfo}>
            {[1,2,3].map(t => (
              <div key={t} style={rmStyles.gRow}>
                <span style={rmStyles.gLbl}>T{t} ({(config.TIER_RISK_PCT?.[t] ?? 0).toFixed(1)}%)</span>
                <span style={{...rmStyles.gVal, color: bot_state.tier_restricted && t>1 ? '#3e3e52' : t===3?'#F7931A':t===2?'#a78bfa':'#5a5a6e'}}>
                  {bot_state.tier_restricted && t>1 ? '⊘ Blocked' : '✓ Active'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* EV table */}
      <div style={rmStyles.card}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div style={rmStyles.cardTitle}>
            Expected Value by Setup
            <span style={{fontSize:11, color:'#3e3e52', fontWeight:400, marginLeft:8}}>
              Based on {hideWeak ? displayedEV.reduce((a,s)=>a+s.total,0) : closed.length} closed trades
            </span>
          </div>
          <button onClick={() => setHideWeak(v => !v)} style={{
            fontSize:11, fontWeight:600, padding:'5px 12px', borderRadius:6, cursor:'pointer', border:'none',
            background: hideWeak ? 'rgba(0,208,132,0.15)' : 'rgba(255,77,109,0.1)',
            color: hideWeak ? '#00d084' : '#ff4d6d',
          }}>
            {hideWeak ? '✓ Showing strong edge only' : 'Hide marginal (T3)'}
          </button>
        </div>

        {closed.length === 0 ? (
          <div style={{padding:'32px 0', textAlign:'center', color:'#2a2a38', fontSize:12}}>
            Will populate after first closed trade
          </div>
        ) : (
        <table style={{width:'100%', borderCollapse:'collapse', marginTop:14}}>
          <thead>
            <tr>{['Setup','Tier','Trades','Win Rate','Avg Win R','Avg Loss R','EV per trade','Edge?'].map(h=>(
              <th key={h} style={{textAlign:'left',fontSize:10,color:'#3e3e52',fontWeight:600,padding:'8px 12px',letterSpacing:'0.5px',borderBottom:'1px solid #1a1a22'}}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {displayedEV.map(s => {
              const key   = s.type.toLowerCase();
              const name  = RM_STRAT_NAMES[key] || s.type;
              const tier  = RM_STRAT_TIER[key] || '?';
              const tierC = tier===1?'#a78bfa':tier===2?'#60a5fa':'#F7931A';
              const isWeak = s.ev <= 0.3 && s.total >= 10;
              return (
                <tr key={s.type} style={{borderBottom:'1px solid #16161e',
                  opacity: hideWeak && isWeak ? 0.4 : 1}}>
                  <td style={{padding:'11px 12px', fontSize:12, color:'#ece9e2', fontWeight:600, maxWidth:280}}>
                    {name}
                  </td>
                  <td style={{padding:'11px 12px'}}>
                    <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                      background:`${tierC}18`,color:tierC}}>T{tier}</span>
                  </td>
                  <td style={{padding:'11px 12px',fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:'#5a5a6e'}}>{s.total}</td>
                  <td style={{padding:'11px 12px',fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:s.wr>=0.6?'#00d084':s.wr>=0.5?'#F7931A':'#ff4d6d'}}>{(s.wr*100).toFixed(0)}%</td>
                  <td style={{padding:'11px 12px',fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:'#00d084'}}>+{parseFloat(s.avgW).toFixed(2)}R</td>
                  <td style={{padding:'11px 12px',fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:s.avgL>0?'#ff4d6d':'#3e3e52'}}>{s.avgL>0?`-${parseFloat(s.avgL).toFixed(2)}R`:'—'}</td>
                  <td style={{padding:'11px 12px',fontSize:14,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:s.ev>0?'#00d084':'#ff4d6d'}}>{s.ev>0?'+':''}{parseFloat(s.ev).toFixed(2)}R</td>
                  <td style={{padding:'11px 12px'}}>
                    <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:5,
                      background:s.ev>0.5?'rgba(0,208,132,0.12)':s.ev>0.15?'rgba(247,147,26,0.1)':'rgba(255,77,109,0.1)',
                      color:s.ev>0.5?'#00d084':s.ev>0.15?'#F7931A':'#ff4d6d'}}>
                      {s.ev>0.5?'Strong Edge':s.ev>0.15?'Marginal':'No Edge'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {/* Session history */}
      <div style={rmStyles.card}>
        <div style={rmStyles.cardTitle}>Session Drawdown History</div>
        <div style={{display:'flex', flexDirection:'column', gap:8, marginTop:14}}>
          {data.session_dd.map(s => (
            <div key={s.date} style={{display:'flex', gap:12, alignItems:'center'}}>
              <span style={{fontSize:12, color:'#3e3e52', fontFamily:"'JetBrains Mono',monospace", width:96, flexShrink:0}}>{s.date}</span>
              <div style={{flex:1, height:5, background:'#1a1a22', borderRadius:3, overflow:'hidden'}}>
                {s.dd < 0 && <div style={{width:`${Math.min(Math.abs(s.dd)/10*100,100)}%`, height:'100%', background:'#ff4d6d', borderRadius:3}}></div>}
                {s.dd === 0 && s.end > s.start && <div style={{width:'100%', height:'100%', background:'rgba(0,208,132,0.3)', borderRadius:3}}></div>}
              </div>
              <span style={{fontSize:12, fontFamily:"'JetBrains Mono',monospace", width:56, textAlign:'right',
                color:s.dd<0?'#ff4d6d':s.end>s.start?'#00d084':'#3e3e52'}}>
                {s.dd !== 0 ? `${s.dd.toFixed(1)}%` : s.end>s.start ? `+$${(s.end-s.start).toFixed(0)}` : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const rmStyles = {
  wrap: { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  gaugeRow: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 },
  gaugeCard: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 20px' },
  card: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 22px', marginBottom:14 },
  cardTitle: { fontSize:13, fontWeight:600, color:'#ece9e2' },
  gaugeInfo: { display:'flex', flexDirection:'column', gap:7, marginTop:8 },
  gRow: { display:'flex', justifyContent:'space-between', alignItems:'center' },
  gLbl: { fontSize:11, color:'#3e3e52' },
  gVal: { fontSize:12, fontWeight:600, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace" },
};

Object.assign(window, { RiskMonitor });
