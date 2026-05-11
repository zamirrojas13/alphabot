
function SignalCheck({ data, viewMode }) {
  const { last_signal, config, account, bot_state, ev_by_setup } = data;
  const sig = last_signal;

  // Live pattern levels from /api/signals (live mode only)
  const [livePatterns, setLivePatterns] = React.useState(null);
  const [lastScan, setLastScan]         = React.useState(null);
  React.useEffect(() => {
    if (viewMode !== 'live') return;
    const load = () =>
      fetch('/api/signals').then(r => r.json()).then(d => {
        setLivePatterns(d.patterns || []);
        setLastScan(d.last_scan_time || null);
      }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [viewMode]);

  // Position size calculator state
  const [equity, setEquity]     = React.useState(account.equity);
  const [tier, setTier]         = React.useState(3);
  const [customRisk, setCustomRisk] = React.useState(false);
  const [riskPct, setRiskPct]   = React.useState(config.TIER_RISK[3] / account.account_size * 100);
  const [entryPrice, setEntryPrice] = React.useState(sig?.price || 94200);
  const [slPrice, setSlPrice]   = React.useState(sig?.sl || 92785);
  const [tpPrice, setTpPrice]   = React.useState(sig?.tp || 98440);

  const slDist  = Math.abs(entryPrice - slPrice);
  const tpDist  = Math.abs(tpPrice - entryPrice);
  const rr      = slDist > 0 ? (tpDist / slDist).toFixed(2) : '—';
  const riskUsd = (equity * riskPct / 100);
  const qty     = slDist > 0 ? (riskUsd / slDist).toFixed(6) : '—';
  const posUsd  = slDist > 0 ? (qty * entryPrice).toFixed(2) : '—';
  const reqRR   = config.TIER_RR[tier];
  const rrMet   = parseFloat(rr) >= reqRR;

  // Tier risk % using live equity input
  const tierPct = t => (config.TIER_RISK_PCT[t]).toFixed(1);
  const tierUsd = t => (equity * config.TIER_RISK_PCT[t] / 100).toFixed(0);

  const hasActiveTrade = bot_state.active_trade?.qty > 0;

  // Checklist items — removed redundant "Conditions count" row
  const checks = sig ? [
    { label:'Direction',          sub:'Trade direction identified',                         pass: !!sig.direction,                              val: sig.direction?.toUpperCase() || '—' },
    { label:'Weekly alignment',   sub:'Weekly candle is in a bullish structure',            pass: sig.alignment.weekly_ok,                      val: sig.alignment.weekly_ok ? 'Bullish' : 'Not aligned' },
    { label:'Daily alignment',    sub:'Daily candle confirms bullish bias',                 pass: sig.alignment.daily_ok,                       val: sig.alignment.daily_ok  ? 'Bullish' : 'Not aligned' },
    { label:'H4 alignment',       sub:'4-hour candle is in uptrend',                       pass: sig.alignment.h4_ok,                          val: sig.alignment.h4_ok    ? 'Bullish' : 'Not aligned' },
    { label:'Trend condition',    sub:'EMA50 > EMA200 on H4 — market is trending up',      pass: sig.conditions.trend,                         val: sig.conditions.trend   ? 'Pass' : 'Fail' },
    { label:'Pattern condition',  sub:'The specific candle pattern is confirmed',           pass: sig.conditions.pattern,                       val: sig.conditions.pattern ? 'Pass' : 'Fail' },
    { label:'Extreme condition',  sub:'Price or RSI is at an extreme — good entry zone',   pass: sig.conditions.extreme,                       val: sig.conditions.extreme ? 'Pass' : 'Fail' },
    { label:'Setup type',         sub:'A recognised pattern name was detected',            pass: sig.setup_type && sig.setup_type !== '—',     val: sig.setup_type && sig.setup_type !== '—' ? sig.setup_type : 'None detected' },
    { label:'Quality grade',      sub:'A+ / Solid = high historical WR · B = moderate',   pass: ['A+','Solid','B'].includes(sig.grade),        val: sig.grade || '—' },
    { label:'Risk tier valid',    sub:'Tier 1–3 assigned based on setup quality',          pass: sig.tier >= 1 && sig.tier <= 3,               val: `T${sig.tier}` },
    { label:'R:R meets minimum',  sub:'Reward must be at least the tier minimum',          pass: sig.rr >= config.TIER_RR[sig.tier],           val: `${parseFloat(sig.rr || 0).toFixed(2)} (need ≥${config.TIER_RR[sig.tier]})` },
    { label:'Tier not restricted',sub:'No active loss streak blocking this tier',          pass: !(bot_state.tier_restricted && sig.tier > 1), val: bot_state.tier_restricted && sig.tier>1 ? '⚠ Blocked' : 'Clear' },
    { label:'No active trade',    sub:'Bot can only hold one position at a time',          pass: !hasActiveTrade,                              val: hasActiveTrade ? 'Trade open' : 'Clear' },
  ] : [];

  const passCount = checks.filter(c => c.pass).length;
  const allPass   = passCount === checks.length;
  const evMatch   = ev_by_setup?.find(e => e.type === sig?.setup_type);

  const lvlColor = lvl => lvl === 3 ? '#00d084' : lvl === 2 ? '#F7931A' : '#5a5a6e';
  const lvlBg    = lvl => lvl === 3 ? 'rgba(0,208,132,0.08)' : lvl === 2 ? 'rgba(247,147,26,0.08)' : 'transparent';

  return (
    <div style={scStyles.wrap}>
      <div style={scStyles.pageTitle}>Signal Checklist &amp; Position Calculator</div>

      {/* ── Live Pattern Radar (live mode only) ── */}
      {viewMode === 'live' && (
        <div style={{marginBottom:20, background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 22px'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <span style={{fontSize:13, fontWeight:600, color:'#ece9e2'}}>📡 Live Pattern Radar</span>
            <span style={{fontSize:11, color:'#3e3e52'}}>
              {lastScan ? `Last scan: ${lastScan}` : 'Waiting for scan…'}
              {' · '}Auto-refreshes every 60s
            </span>
          </div>
          {livePatterns === null ? (
            <div style={{fontSize:12, color:'#3e3e52'}}>Loading…</div>
          ) : livePatterns.length === 0 ? (
            <div style={{fontSize:12, color:'#3e3e52'}}>All strategies idle — no patterns building right now.</div>
          ) : (
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px,1fr))', gap:8}}>
              {livePatterns.map(p => (
                <div key={p.strat_id} style={{
                  padding:'10px 14px', borderRadius:7,
                  background: lvlBg(p.level),
                  border: `1px solid ${lvlColor(p.level)}33`,
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                }}>
                  <div>
                    <div style={{fontSize:12, color:'#ece9e2', fontWeight:600}}>{p.name}</div>
                    <div style={{fontSize:10, color:'#5a5a6e', marginTop:2}}>
                      {p.side === 'long' ? '▲ BUY setup' : '▼ SELL setup'}
                    </div>
                  </div>
                  <span style={{
                    fontSize:11, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                    color: lvlColor(p.level),
                    background: lvlBg(p.level),
                    padding:'3px 8px', borderRadius:4, whiteSpace:'nowrap', marginLeft:12,
                  }}>{p.level_label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={scStyles.grid}>
        {/* Checklist */}
        <div style={scStyles.card}>
          <div style={scStyles.cardHead}>
            <span style={scStyles.cardTitle}>Pre-Trade Checklist</span>
            <div style={{display:'flex', gap:8, alignItems:'center'}}>
              {sig && <><GradeBadge grade={sig.grade} /><TierBadge tier={sig.tier} /></>}
              <span style={{fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                color: allPass?'#00d084': passCount>=10?'#F7931A':'#ff4d6d'}}>
                {passCount}/{checks.length}
              </span>
            </div>
          </div>

          {sig ? (
            <>
              {/* Summary bar */}
              <div style={{height:4, background:'#1a1a22', borderRadius:2, margin:'12px 0', overflow:'hidden'}}>
                <div style={{width:`${(passCount/checks.length)*100}%`, height:'100%',
                  background: allPass?'#00d084':passCount>=10?'#F7931A':'#ff4d6d', borderRadius:2, transition:'width 0.4s'}}></div>
              </div>

              {/* Entry verdict */}
              <div style={{...scStyles.verdict, background: allPass?'rgba(0,208,132,0.08)':'rgba(255,77,109,0.07)',
                border:`1px solid ${allPass?'rgba(0,208,132,0.25)':'rgba(255,77,109,0.2)'}`,
                color: allPass?'#00d084':'#ff4d6d'}}>
                {allPass ? '✓ All conditions met — entry valid' : `⚠ ${checks.length - passCount} condition${checks.length-passCount>1?'s':''} failed — review before entry`}
              </div>

              {/* Checklist rows */}
              <div style={{display:'flex', flexDirection:'column', gap:1, marginTop:10}}>
                {checks.map(c => (
                  <div key={c.label} style={{display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'8px 10px', borderRadius:5, background: c.pass?'transparent':'rgba(255,77,109,0.04)'}}>
                    <div style={{display:'flex', gap:8, alignItems:'flex-start'}}>
                      <span style={{fontSize:13, color: c.pass?'#00d084':'#ff4d6d', marginTop:1, flexShrink:0}}>{c.pass?'✓':'✗'}</span>
                      <div>
                        <div style={{fontSize:12, color: c.pass?'#5a5a6e':'#ece9e2'}}>{c.label}</div>
                        {!c.pass && <div style={{fontSize:10, color:'#3e3e52', marginTop:2}}>{c.sub}</div>}
                      </div>
                    </div>
                    <span style={{fontSize:11, fontFamily:"'JetBrains Mono',monospace", flexShrink:0, marginLeft:12,
                      color: c.pass?'#3e3e52':'#F7931A'}}>{c.val}</span>
                  </div>
                ))}
              </div>

              {/* EV context */}
              {evMatch && (
                <div style={{marginTop:14, padding:'10px 12px', background:'#0d0d11', borderRadius:7, border:'1px solid #1a1a22'}}>
                  <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', marginBottom:6}}>HISTORICAL EDGE · {sig.setup_type.toUpperCase()}</div>
                  <div style={{display:'flex', gap:16}}>
                    <span style={{fontSize:12, color:'#5a5a6e'}}>WR: <span style={{color:evMatch.wr>=0.6?'#00d084':'#F7931A'}}>{(evMatch.wr*100).toFixed(0)}%</span></span>
                    <span style={{fontSize:12, color:'#5a5a6e'}}>EV: <span style={{color:evMatch.ev>0?'#00d084':'#ff4d6d'}}>{evMatch.ev>0?'+':''}{evMatch.ev}R</span></span>
                    <span style={{fontSize:12, color:'#5a5a6e'}}>Avg W: <span style={{color:'#00d084'}}>+{evMatch.avgW}R</span></span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{fontSize:13, color:'#3e3e52', marginTop:24, textAlign:'center'}}>No active signal</div>
          )}
        </div>

        {/* Position size calculator */}
        <div style={scStyles.card}>
          <div style={scStyles.cardTitle}>Position Size Calculator</div>

          <div style={scStyles.calcGrid}>
            {/* Tier selector */}
            <div style={scStyles.fieldWrap}>
              <div style={scStyles.fieldLabel}>Risk Tier</div>
              <div style={{display:'flex', gap:6}}>
                {[1,2,3].map(t => (
                  <button key={t} onClick={() => { setTier(t); if(!customRisk) setRiskPct(parseFloat(tierPct(t))); }}
                    style={{flex:1, padding:'8px 4px', borderRadius:6, border:'none', cursor:'pointer',
                      fontFamily:"'Space Grotesk',sans-serif", fontSize:11, fontWeight:700,
                      background: tier===t?'rgba(247,147,26,0.15)':'#0d0d11',
                      color: tier===t?'#F7931A':'#3e3e52',
                      outline: tier===t?'1px solid rgba(247,147,26,0.3)':'1px solid #1f1f28'}}>
                    <div>T{t} · {tierPct(t)}%</div>
                    <div style={{fontSize:10, fontWeight:400, marginTop:2, color: tier===t?'#F7931A':'#2a2a38'}}>${tierUsd(t)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={scStyles.fieldWrap}>
              <div style={scStyles.fieldLabel}>Account Equity ($)</div>
              <input type="number" value={equity} onChange={e => setEquity(+e.target.value)} style={scStyles.input} />
            </div>

            <div style={scStyles.fieldWrap}>
              <div style={scStyles.fieldLabel}>Risk % <span style={{color:'#3e3e52', fontSize:10}}>(override)</span></div>
              <input type="number" value={riskPct} min={0.1} max={20} step={0.1}
                onChange={e => { setRiskPct(+e.target.value); setCustomRisk(true); }} style={scStyles.input} />
            </div>

            <div style={scStyles.fieldWrap}>
              <div style={scStyles.fieldLabel}>Entry Price ($)</div>
              <input type="number" value={entryPrice} onChange={e => setEntryPrice(+e.target.value)} style={scStyles.input} />
            </div>

            <div style={scStyles.fieldWrap}>
              <div style={scStyles.fieldLabel}>Stop Loss ($)</div>
              <input type="number" value={slPrice} onChange={e => setSlPrice(+e.target.value)} style={scStyles.input} />
            </div>

            <div style={scStyles.fieldWrap}>
              <div style={scStyles.fieldLabel}>Take Profit ($)</div>
              <input type="number" value={tpPrice} onChange={e => setTpPrice(+e.target.value)} style={scStyles.input} />
            </div>
          </div>

          {/* Results */}
          <div style={scStyles.resultsBox}>
            <div style={scStyles.resultRow}>
              <span style={scStyles.rLabel}>SL Distance</span>
              <span style={scStyles.rVal}>${slDist.toFixed(0)}</span>
            </div>
            <div style={scStyles.resultRow}>
              <span style={scStyles.rLabel}>TP Distance</span>
              <span style={scStyles.rVal}>${tpDist.toFixed(0)}</span>
            </div>
            <div style={scStyles.resultRow}>
              <span style={scStyles.rLabel}>R:R Ratio</span>
              <span style={{...scStyles.rVal, color: rrMet?'#00d084':'#ff4d6d'}}>
                1 : {parseFloat(rr).toFixed(2)} {rrMet ? '✓' : `⚠ min for T${tier} is ${reqRR}×`}
              </span>
            </div>

            <div style={{borderTop:'1px solid #1a1a22', marginTop:4, paddingTop:12, display:'flex', flexDirection:'column', gap:9}}>
              {/* Max loss — most important number */}
              <div style={scStyles.resultRow}>
                <div>
                  <div style={scStyles.rLabel}>Max Loss (your risk)</div>
                  <div style={{fontSize:10, color:'#2a2a38', marginTop:2}}>This is the only money you can lose</div>
                </div>
                <span style={{...scStyles.rVal, color:'#ff4d6d'}}>${riskUsd.toFixed(2)} <span style={{fontSize:11, color:'#5a5a6e'}}>({riskPct.toFixed(1)}%)</span></span>
              </div>

              <div style={scStyles.resultRow}>
                <span style={scStyles.rLabel}>Position Size (BTC)</span>
                <span style={{...scStyles.rVal, fontSize:18, color:'#F7931A'}}>{qty} BTC</span>
              </div>
              <div style={scStyles.resultRow}>
                <div>
                  <div style={scStyles.rLabel}>Position Value (USD)</div>
                  <div style={{fontSize:10, color:'#2a2a38', marginTop:2}}>Total BTC value — not what you risk</div>
                </div>
                <span style={{...scStyles.rVal, color:'#ece9e2'}}>${parseFloat(posUsd).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Load from signal button */}
          {sig && (
            <button onClick={() => {
              setEntryPrice(sig.price);
              setSlPrice(sig.sl);
              setTpPrice(sig.tp);
              setTier(sig.tier);
              setRiskPct(parseFloat(tierPct(sig.tier)));
              setCustomRisk(false);
            }} style={scStyles.loadBtn}>
              ↓ Load from last signal (T{sig.tier} · {sig.setup_type})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const scStyles = {
  wrap: { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px', marginBottom:22 },
  grid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
  card: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'20px 22px' },
  cardHead: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 },
  cardTitle: { fontSize:13, fontWeight:600, color:'#ece9e2', marginBottom:4 },
  verdict: { padding:'10px 14px', borderRadius:7, fontSize:13, fontWeight:600 },
  calcGrid: { display:'flex', flexDirection:'column', gap:12, marginTop:14 },
  fieldWrap: { display:'flex', flexDirection:'column', gap:5 },
  fieldLabel: { fontSize:11, color:'#3e3e52', letterSpacing:'0.3px' },
  input: { background:'#0d0d11', border:'1px solid #1f1f28', borderRadius:6, padding:'8px 12px', color:'#ece9e2', fontSize:13, fontFamily:"'JetBrains Mono',monospace", outline:'none', width:'100%', boxSizing:'border-box' },
  resultsBox: { background:'#0d0d11', border:'1px solid #1a1a22', borderRadius:8, padding:'14px 16px', marginTop:14, display:'flex', flexDirection:'column', gap:9 },
  resultRow: { display:'flex', justifyContent:'space-between', alignItems:'center' },
  rLabel: { fontSize:12, color:'#3e3e52' },
  rVal: { fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2' },
  loadBtn: { marginTop:12, width:'100%', padding:'10px', borderRadius:7, border:'1px solid rgba(247,147,26,0.25)', background:'rgba(247,147,26,0.08)', color:'#F7931A', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif' " },
};

Object.assign(window, { SignalCheck });
