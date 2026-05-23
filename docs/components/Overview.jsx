
function KpiCard({ label, value, sub, subColor, accent, mono, tooltip }) {
  const [tip, setTip] = React.useState(false);
  return (
    <div className="ab-card" style={{...ovStyles.kpiCard, position:'relative'}} onMouseLeave={() => setTip(false)}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8}}>
        <div style={{...ovStyles.kpiLabel, marginBottom:0}}>{label}</div>
        {tooltip && (
          <div onMouseEnter={() => setTip(true)}
            style={{fontSize:9, color:'#3e3e52', cursor:'default', width:15, height:15, borderRadius:'50%',
              border:'1px solid #2a2a38', display:'flex', alignItems:'center', justifyContent:'center',
              flexShrink:0, marginLeft:4, lineHeight:1}}>?</div>
        )}
      </div>
      {tip && tooltip && (
        <div style={{position:'absolute', top:'calc(100% + 4px)', left:0, right:0, background:'#17171e',
          border:'1px solid #2a2a38', borderRadius:6, padding:'8px 10px', fontSize:11, color:'#ece9e2',
          lineHeight:1.5, zIndex:200, boxShadow:'0 4px 16px rgba(0,0,0,0.6)'}}>
          {tooltip}
        </div>
      )}
      <div style={{...ovStyles.kpiValue, color: accent || '#ece9e2', fontFamily: mono !== false ? "'JetBrains Mono',monospace" : "'Space Grotesk',sans-serif", animation:'fadeUp 0.4s ease-out forwards', textShadow: accent==='#00d084'?'0 0 10px rgba(0,208,132,0.3)':accent==='#ff4d6d'?'0 0 10px rgba(255,77,109,0.3)':'none'}}>{value}</div>
      {sub && <div style={{...ovStyles.kpiSub, color: subColor || '#5a5a6e'}}>{sub}</div>}
    </div>
  );
}

function GradeBadge({ grade }) {
  const map = { 'A+': { bg:'rgba(247,147,26,0.15)', c:'#F7931A' }, 'Solid': { bg:'rgba(0,208,132,0.12)', c:'#00d084' }, 'B': { bg:'rgba(167,139,250,0.12)', c:'#a78bfa' }, 'C': { bg:'rgba(90,90,110,0.12)', c:'#5a5a6e' } };
  const s = map[grade] || map['C'];
  return <span style={{fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:s.bg, color:s.c, letterSpacing:'0.5px'}}>{grade}</span>;
}

function TierBadge({ tier }) {
  const map = { 1:{bg:'rgba(90,90,110,0.12)',c:'#5a5a6e'}, 2:{bg:'rgba(167,139,250,0.12)',c:'#a78bfa'}, 3:{bg:'rgba(247,147,26,0.15)',c:'#F7931A'} };
  const s = map[tier] || map[1];
  return <span style={{fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:s.bg, color:s.c, letterSpacing:'0.5px'}}>T{tier}</span>;
}

function SparkLine({ data, color, height = 80 }) {
  const W = 600, H = height;
  const PAD_T = 8, PAD_B = 10;
  const vals = (data && data.length > 1 ? data : [{v:0},{v:1}]).map(d => d.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const usable = H - PAD_T - PAD_B;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = PAD_T + usable - ((v - min) / range) * usable;
    return `${x},${y}`;
  }).join(' ');
  const firstPt = pts.split(' ')[0];
  const lastPt  = pts.split(' ').slice(-1)[0];
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display:'block' }}>
      <defs>
        <linearGradient id="spkGrad2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#spkGrad2)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="3000" style={{animation:'spkDraw 0.6s ease-in-out forwards'}} />
      {/* start dot */}
      <circle cx={firstPt.split(',')[0]} cy={firstPt.split(',')[1]} r="4" fill={color} opacity="0.5" />
      {/* end dot with glow */}
      <circle cx={lastPt.split(',')[0]} cy={lastPt.split(',')[1]} r="5" fill={color} opacity="0.25" />
      <circle cx={lastPt.split(',')[0]} cy={lastPt.split(',')[1]} r="3" fill={color} />
    </svg>
  );
}

// ── market session helper ────────────────────────────────────────────────────
function getMarketSessions() {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const sessions = [];
  if (h >= 0  && h < 8)    sessions.push({ name:'Asia',     color:'#a78bfa' });
  if (h >= 8  && h < 16.5) sessions.push({ name:'London',   color:'#38bdf8' });
  if (h >= 13.5 && h < 21) sessions.push({ name:'New York', color:'#00d084' });
  return sessions.length ? sessions : [{ name:'Off-hours', color:'#3e3e52' }];
}

// ── simple log-prefix strip for TG preview ──────────────────────────────────
function stripTgPreview(raw) {
  return raw
    .replace(/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?(\s*UTC)?/,'')
    .replace(/^[\s\-|]*INFO[\s\-|]*/i,'')
    .replace(/^[\s\-|]*Telegram[\s\-:]+/i,'')
    .replace(/^[\s\-|]*Sent[\s\-:]+/i,'')
    .trim();
}

const STRAT_DESCS = {
  't1a_w_fail_brkdn_long':          'Price broke below a key low but recovered. The drop was a fakeout — smart money absorbed all the sellers.',
  't1b_w_rsi_os_long':              'Price dropped so far it\'s exhausted. Weekly RSI in oversold territory signals a major bounce opportunity.',
  't1c_d_sstar_short':              'Price pushed to a new high but got rejected hard. Daily shooting star = buyers are tapped out.',
  't1d_h4_sweep_hi_short':          '4-hour price poked above resistance briefly then came back. Classic stop hunt before a reversal.',
  't1e_w_oversold_hammer_long':     'In an uptrend, price dipped but bounced strongly off the low. Weekly hammer in uptrend = buy the dip.',
  't1f_h4_willy_rev_short':         'Momentum pushed overbought on both fast and slow signals, then both confirmed reversal. Daily and weekly trend both down.',
  't2c_w_bull_engulf_long':         'Big green weekly candle swallowed the prior red. Momentum confirmed back up — trend resuming.',
  't1g_h4_vol_surge_long':          'Massive volume at a low with oversold momentum confirmed on two timeframes — strong reversal signal.',
  't1h_h4_vol_surge_short':         'Massive volume at a high with overbought momentum — exhaustion signal confirmed on two timeframes.',
  't2a_d_hammer_long':              'Daily candle had long lower wick — buyers stepped in aggressively at the low. Reversal likely.',
  't2b_w_sweep_hi_short':           'Weekly price spiked above a key high then snapped back. Bulls tried and failed — bears in control.',
  't2d_d_squeeze_brk_long':         'Price coiled tight for 3 days then broke out above the range with volume. Energy release — momentum trade.',
  't2e_w_mo_reclaim_long':          'Weekly price dipped below the monthly open but reclaimed it with volume. Monthly bias reasserting.',
  't2f_h4_rsi_bear_div_short':      'Price made a new high but momentum was weaker. Classic divergence — the move is losing fuel.',
  't2g_d_bull_flag_long':           '5-day tight consolidation in an uptrend breaks out with volume. Classic continuation setup.',
  't3a_h1_fail_brkdn_long':         '1-hour price broke a low then recovered instantly. Short-term fakeout bounce.',
  't3b_h4_sweep_hi_short_loose':    '4-hour price quickly tagged a high and rejected. Looser version of the 4H sweep — lower tier.',
  't3c_w_5bar_low_long':            'Price made a 5-week low then turned. Contrarian reversal at multi-week lows.',
  'c3_w_engulf_long':               'Weekly bullish engulfing candle — the entire prior week\'s range consumed by buyers.',
  'c5_w_hammer_20w_low_long':       'Price hit a 20-week low and printed a hammer. Exhaustion at a major support level.',
  // v8 strategies
  't_h4_sweep_lo_long':             'H4 price briefly wicked below support then snapped back. Buyers absorbed the dip — classic stop hunt before reversal.',
  't_w_ema50_dip_long':             'Weekly price pulled back to the 50-week average and bounced with a green close. Classic bull market buy-the-dip setup.',
  't_d_ema200_bounce_long':         'Daily candle wicked below the 200-day moving average but closed above it with above-average volume. Key support held.',
  't_d_hi20_breakout_long':         'Daily close above the 20-day high with strong volume and momentum. Price discovery breakout.',
  't_d_sweep_lo_long':              'Daily price wicked below the 20-day low then closed back above it. Stop hunt absorbed — buyers stepped in.',
};

const STRAT_NAMES = {
  't1c_d_sstar_short':              'Daily A · Failed Top',
  't2b_w_sweep_hi_short':           'Weekly A · Top Trap',
  't1a_w_fail_brkdn_long':          'Weekly A · Fake Crash Bounce',
  't1b_w_rsi_os_long':              'Weekly A · Deep Drop Bounce',
  't1d_h4_sweep_hi_short':          '4H A · Fake High Reversal',
  't1e_w_oversold_hammer_long':     'Weekly A · Trend Dip Bounce',
  't2c_w_bull_engulf_long':         'Weekly A · Trend Resume',
  't3c_w_5bar_low_long':            'Weekly B · 5-Week Low',
  't3a_h1_fail_brkdn_long':         '1H C · Quick Bounce',
  't2a_d_hammer_long':              'Daily B · Daily Bounce',
  't3b_h4_sweep_hi_short_loose':    '4H B · Top Reject',
  't1f_h4_willy_rev_short':         '4H A · Willy Exhaustion',
  't2d_d_squeeze_brk_long':         'Daily B · 3-Bar Squeeze',
  't2e_w_mo_reclaim_long':          'Weekly B · Monthly Reclaim',
  't2f_h4_rsi_bear_div_short':      '4H B · RSI Divergence',
  't2g_d_bull_flag_long':           'Daily B · Bull Flag',
  't1g_h4_vol_surge_long':          '4H B · Vol Spike Buy',
  't1h_h4_vol_surge_short':         '4H B · Vol Spike Sell',
  'c5_w_hammer_20w_low_long':       'Weekly · 20W Low Hammer',
  // v8 strategies
  't_h4_sweep_lo_long':             '4H B · Sweep Low Bounce',
  't_w_ema50_dip_long':             'Weekly B · EMA50 Dip',
  't_d_ema200_bounce_long':         'Daily B · EMA200 Bounce',
  't_d_hi20_breakout_long':         'Daily B · 20D Breakout',
  't_d_sweep_lo_long':              'Daily B · Sweep Low',
};

function SetupStatCard({ type, s }) {
  const [tip, setTip] = React.useState(false);
  const total  = s.w + s.l;
  const wr     = total > 0 ? Math.round(s.w / total * 100) : 0;
  const name   = STRAT_NAMES[type.toLowerCase()] || type.replace(/_/g,' ').replace(/^t\d[a-z]?\s/i,'');
  const isLong = type.toLowerCase().endsWith('long');
  const col    = wr >= 60 ? '#00d084' : wr >= 40 ? '#F7931A' : '#ff4d6d';
  const desc   = STRAT_DESCS[type.toLowerCase()] || '';
  return (
    <div onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}
      style={{background:'#0d0d11', borderRadius:8, padding:'10px 12px', border:`1px solid ${tip?'#2a2a38':'#1a1a22'}`, display:'flex', flexDirection:'column', gap:4, position:'relative', cursor:'default', transition:'border-color 0.15s'}}>
      {tip && desc && (
        <div style={{position:'absolute', bottom:'calc(100% + 6px)', left:0, right:0, background:'#17171e',
          border:'1px solid #2a2a38', borderRadius:6, padding:'8px 10px', fontSize:11, color:'#ece9e2',
          lineHeight:1.5, zIndex:100, boxShadow:'0 4px 16px rgba(0,0,0,0.5)'}}>
          {desc}
        </div>
      )}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
        <span style={{fontSize:10, color:'#5a5a6e', lineHeight:1.35, flex:1, marginRight:4}}>{name}</span>
        <span style={{fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:3, flexShrink:0,
          background: isLong?'rgba(0,208,132,0.12)':'rgba(255,77,109,0.12)',
          color: isLong?'#00d084':'#ff4d6d'}}>
          {isLong ? '▲ L' : '▼ S'}
        </span>
      </div>
      <div style={{fontSize:22, fontWeight:700, color:col, fontFamily:"'JetBrains Mono',monospace", lineHeight:1}}>{wr}%</div>
      <div style={{fontSize:10, color:'#3e3e52'}}>{s.w}W · {s.l}L · {total} trades</div>
      <div style={{height:3, background:'#1f1f28', borderRadius:2, marginTop:2}}>
        <div style={{width:`${wr}%`, height:'100%', background:col, borderRadius:2, transition:'width 0.4s'}}></div>
      </div>
    </div>
  );
}

// ── Backtest v9 baselines ─────────────────────────────────────────────────────
const OV_BT_BASELINE = { wr: 57, avgR: 0.40, tpm: 2.5, maxDD: 17.7 };

// Approximate per-strategy backtest WR (used when simData unavailable)
const OV_STRAT_BT_WR = {
  't1a_w_fail_brkdn_long':65, 't1b_w_rsi_os_long':63, 't1c_d_sstar_short':61,
  't1d_h4_sweep_hi_short':62, 't1e_w_oversold_hammer_long':64, 't1f_h4_willy_rev_short':60,
  't1g_h4_vol_surge_long':58, 't1h_h4_vol_surge_short':57,
  't2a_d_hammer_long':55, 't2b_w_sweep_hi_short':58, 't2c_w_bull_engulf_long':57,
  't2d_d_squeeze_brk_long':54, 't2e_w_mo_reclaim_long':56, 't2f_h4_rsi_bear_div_short':53,
  't2g_d_bull_flag_long':55, 't1g_h4_vol_surge_long':58,
  't3a_h1_fail_brkdn_long':50, 't3b_h4_sweep_hi_short_loose':49, 't3c_w_5bar_low_long':52,
  't_h4_sweep_lo_long':56, 't_w_ema50_dip_long':58,
  't_d_ema200_bounce_long':57, 't_d_hi20_breakout_long':55, 't_d_sweep_lo_long':56,
};
const OV_STRAT_TF = {
  't1a_w_fail_brkdn_long':'W', 't1b_w_rsi_os_long':'W', 't1c_d_sstar_short':'D',
  't1d_h4_sweep_hi_short':'4H', 't1e_w_oversold_hammer_long':'W', 't1f_h4_willy_rev_short':'4H',
  't1g_h4_vol_surge_long':'4H', 't1h_h4_vol_surge_short':'4H',
  't2a_d_hammer_long':'D', 't2b_w_sweep_hi_short':'W', 't2c_w_bull_engulf_long':'W',
  't2d_d_squeeze_brk_long':'D', 't2e_w_mo_reclaim_long':'W', 't2f_h4_rsi_bear_div_short':'4H',
  't2g_d_bull_flag_long':'D',
  't3a_h1_fail_brkdn_long':'1H', 't3b_h4_sweep_hi_short_loose':'4H', 't3c_w_5bar_low_long':'W',
  't_h4_sweep_lo_long':'4H', 't_w_ema50_dip_long':'W',
  't_d_ema200_bounce_long':'D', 't_d_hi20_breakout_long':'D', 't_d_sweep_lo_long':'D',
};
const OV_ACTIVE_STRATS = [
  't1a_w_fail_brkdn_long','t1b_w_rsi_os_long','t1c_d_sstar_short','t1d_h4_sweep_hi_short',
  't1e_w_oversold_hammer_long','t1f_h4_willy_rev_short',
  't2a_d_hammer_long','t2b_w_sweep_hi_short','t2c_w_bull_engulf_long','t2d_d_squeeze_brk_long',
  't2f_h4_rsi_bear_div_short','t2g_d_bull_flag_long',
  't_h4_sweep_lo_long','t_d_ema200_bounce_long',
];

// ── strategy health mini-card ─────────────────────────────────────────────────
// Normalize a CSV setup_type string → short key, e.g.
// "4-Hour A · Willy Exhaustion (Sell)" → matches STRAT_NAMES key for t1f_h4_willy_rev_short
function _normSetupType(raw) {
  return (raw || '')
    .replace(/\s*\(Buy\)$/i, '').replace(/\s*\(Sell\)$/i, '')
    .replace(/\b4-Hour\b/gi, '4H').replace(/\b1-Hour\b/gi, '1H')
    .trim().toLowerCase();
}
// Build reverse map: normalized display name → key (built once, lazily)
let _revStratMap = null;
function _getRevStratMap() {
  if (!_revStratMap) {
    _revStratMap = {};
    for (const [k, v] of Object.entries(STRAT_NAMES)) {
      _revStratMap[v.toLowerCase()] = k;
    }
  }
  return _revStratMap;
}

function StratHealthCard({ type, trades, btWR, tierRestricted, onNavigate }) {
  const typeLow  = type.toLowerCase();
  const name     = STRAT_NAMES[typeLow] || type.replace(/_/g,' ');
  const isLong   = typeLow.endsWith('long');
  const tf       = OV_STRAT_TF[typeLow] || '?';
  const tier     = typeLow.startsWith('t1') ? 1 : typeLow.startsWith('t2') ? 2 : typeLow.startsWith('t3') ? 3 : 2;

  const revMap = _getRevStratMap();
  const stratTrades = trades.filter(t => {
    if (t.open) return false;
    const st = (t.setup_type || '').toLowerCase();
    // Short-key match (backtest CSV uses keys directly)
    if (st === typeLow) return true;
    // Full display-name match (live ledger uses human-readable names)
    const resolvedKey = revMap[_normSetupType(t.setup_type)] || revMap[st];
    return resolvedKey === typeLow;
  });
  const wins = stratTrades.filter(t => (parseFloat(t.r_multiple)||0) > 0).length;
  const liveWR = stratTrades.length > 0 ? Math.round(wins/stratTrades.length*100) : null;
  const lastT  = stratTrades.sort((a,b)=>(b.timestamp_exit||'').localeCompare(a.timestamp_exit||''))[0];
  const lastR  = lastT ? parseFloat(lastT.r_multiple || 0) : null;

  const daysAgo = lastT ? (() => {
    try { const d = Math.round((Date.now()-new Date(lastT.timestamp_exit).getTime())/86400000); return d===0?'today':`${d}d ago`; } catch { return '—'; }
  })() : null;

  // Status dot — green:<30d, orange:30-90d, red:restricted/>90d, gray:never
  const restricted = tierRestricted && tier > 1;
  const daysSinceLast = lastT ? Math.round((Date.now() - new Date(lastT.timestamp_exit||'').getTime()) / 86400000) : null;
  let dotColor, dotLabel;
  if (stratTrades.length === 0)                                          { dotColor = '#5a5a6e'; dotLabel = 'Never traded'; }
  else if (restricted || (daysSinceLast != null && daysSinceLast > 90)) { dotColor = '#ff4d6d'; dotLabel = restricted ? 'Restricted' : 'Dormant'; }
  else if (daysSinceLast != null && daysSinceLast > 30)                 { dotColor = '#F7931A'; dotLabel = `${daysSinceLast}d inactive`; }
  else                                                                   { dotColor = '#00d084'; dotLabel = 'Active'; }
  const last5 = stratTrades.slice(0, 5).reverse();

  return (
    <div onClick={() => onNavigate && onNavigate(type)}
      style={{background:'#0d0d11', border:'1px solid #1a1a22', borderRadius:9, padding:'11px 13px',
        cursor: onNavigate ? 'pointer' : 'default', transition:'border-color 0.15s', position:'relative'}}
      onMouseEnter={e=>e.currentTarget.style.borderColor='#2a2a38'}
      onMouseLeave={e=>e.currentTarget.style.borderColor='#1a1a22'}>

      {/* Status dot */}
      <span style={{position:'absolute', top:8, right:8, width:7, height:7, borderRadius:'50%',
        background:dotColor, boxShadow:`0 0 4px ${dotColor}`}}></span>

      {/* Header row */}
      <div style={{display:'flex', gap:5, alignItems:'center', marginBottom:6, paddingRight:16, flexWrap:'wrap'}}>
        <span style={{fontSize:12, color:'#ece9e2', fontWeight:600, lineHeight:1.3}}>{name}</span>
        <span style={{fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:3,
          background:'rgba(90,90,110,0.2)', color:'#5a5a6e'}}>{tf}</span>
        <span style={{fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:3, flexShrink:0,
          background: isLong?'rgba(0,208,132,0.1)':'rgba(255,77,109,0.1)',
          color: isLong?'#00d084':'#ff4d6d'}}>{isLong?'▲ L':'▼ S'}</span>
        <TierBadge tier={tier} />
      </div>

      {/* Stats */}
      <div style={{display:'flex', flexDirection:'column', gap:3}}>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11}}>
          <span style={{color:'#3e3e52'}}>Live WR</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace", color: liveWR==null?'#3e3e52':liveWR>=50?'#00d084':'#ff4d6d', fontWeight:700, fontStyle: liveWR==null?'italic':'normal'}}>
            {liveWR!=null ? `${wins}/${stratTrades.length} (${liveWR}%)` : 'Awaiting first signal'}
            {liveWR!=null && btWR ? ` vs ${btWR}% BT` : ''}
          </span>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11}}>
          <span style={{color:'#3e3e52'}}>Last trade</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace",
            color: lastR==null?'#3e3e52':lastR>0?'#00d084':'#ff4d6d',
            fontStyle: lastR==null?'italic':'normal'}}>
            {lastR!=null ? `${lastR>=0?'+':''}${lastR.toFixed(2)}R ${daysAgo}` : 'No live trades yet'}
          </span>
        </div>
      </div>

      {/* Mini WR bar */}
      {liveWR != null && (
        <div style={{height:2, background:'#1f1f28', borderRadius:1, marginTop:7}}>
          <div style={{width:`${liveWR}%`, height:'100%', borderRadius:1,
            background: liveWR>=50?'#00d084':liveWR>=40?'#F7931A':'#ff4d6d', transition:'width 0.4s'}}></div>
        </div>
      )}

      {/* W/L sequence dots — last 5, oldest→newest */}
      <div style={{display:'flex', gap:3, marginTop:6, alignItems:'center'}}>
        {last5.length === 0
          ? [0,1,2,3,4].map(i => <span key={i} style={{width:7,height:7,borderRadius:'50%',background:'#1f1f28',flexShrink:0,display:'inline-block'}}></span>)
          : last5.map((tr,i) => { const w=(parseFloat(tr.r_multiple)||0)>0; return <span key={i} style={{width:7,height:7,borderRadius:'50%',background:w?'#00d084':'#ff4d6d',boxShadow:`0 0 3px ${w?'#00d084':'#ff4d6d'}`,flexShrink:0,display:'inline-block'}}></span>; })
        }
        {daysSinceLast != null && daysSinceLast > 30 && (
          <span style={{fontSize:9,color:'#F7931A',marginLeft:'auto',fontFamily:"'JetBrains Mono',monospace"}}>{daysSinceLast}d ago</span>
        )}
      </div>
    </div>
  );
}

// ── bot performance vs model widget ──────────────────────────────────────────
function ComparisonWidget({ stats, trades }) {
  const closed = (trades || []).filter(t => !t.open);
  const { wr:btWR, avgR:btAvgR, tpm:btTpm, maxDD:btMaxDD } = OV_BT_BASELINE;

  const liveWR    = closed.length ? (stats?.win_rate ?? null) : null;
  const liveAvgR  = closed.length ? (stats?.avg_r  ?? null) : null;
  const liveMaxDD = closed.length ? Math.abs(stats?.max_drawdown ?? stats?.max_dd_pct ?? 0) : null;
  const firstDate = closed.length
    ? new Date([...closed].sort((a,b)=>(a.timestamp_exit||'').localeCompare(b.timestamp_exit||''))[0].timestamp_exit||'')
    : null;
  const monthsActive = firstDate ? Math.max(1, (Date.now()-firstDate.getTime())/2592000000) : null;
  const liveTpm = (monthsActive && closed.length) ? +(closed.length/monthsActive).toFixed(1) : null;

  const NEED10 = { sym:'?', col:'#5a5a6e', tip:'Need 10+ trades for reliable comparison' };
  const statusWR  = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live >= btWR - 10) return { sym:'✓', col:'#00d084' };
    if (live >= btWR - 25) return { sym:'⚠', col:'#F7931A' };
    return { sym:'✗', col:'#ff4d6d' };
  };
  const statusAvgR = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live >= btAvgR - 0.1) return { sym:'✓', col:'#00d084' };
    if (live >= btAvgR - 0.2) return { sym:'⚠', col:'#F7931A' };
    return { sym:'✗', col:'#ff4d6d' };
  };
  const statusTpm = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live >= btTpm * 0.5 && live <= btTpm * 1.5) return { sym:'✓', col:'#00d084' };
    return { sym:'⚠', col:'#F7931A' };
  };
  const statusDD = live => {
    if (live == null) return { sym:'—', col:'#3e3e52' };
    if (closed.length < 10) return NEED10;
    if (live > btMaxDD + 5) return { sym:'✗', col:'#ff4d6d' };
    return { sym:'✓', col:'#00d084' };
  };

  const rows = [
    { label:'Win Rate',       bt:`${btWR}%`,     live: liveWR   !=null ? `${liveWR}%`   : null, st: statusWR(liveWR) },
    { label:'Avg R / trade',  bt:`+${btAvgR}R`,  live: liveAvgR !=null ? `${liveAvgR>=0?'+':''}${liveAvgR.toFixed(2)}R` : null, st: statusAvgR(liveAvgR) },
    { label:'Trades/month',   bt:`~${btTpm}`,    live: liveTpm  !=null ? `${liveTpm}` : null, st: statusTpm(liveTpm) },
    { label:'Max Drawdown',   bt:`-${btMaxDD}%`, live: liveMaxDD!=null ? `-${liveMaxDD.toFixed(1)}%` : null, st: statusDD(liveMaxDD) },
  ];

  const mono = { fontFamily:"'JetBrains Mono',monospace" };

  return (
    <div style={{background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'16px 20px', marginBottom:16}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <span style={{fontSize:13, fontWeight:600, color:'#ece9e2'}}>Bot Performance vs Model</span>
        <span style={{fontSize:11, color:'#3e3e52'}}>Backtest v9 baseline</span>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8}}>
        {rows.map(r => (
          <div key={r.label} style={{background:'#0d0d11', borderRadius:8, padding:'10px 12px', border:'1px solid #1a1a22'}}>
            <div style={{fontSize:10, color:'#3e3e52', marginBottom:6}}>{r.label}</div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:4, marginBottom:3}}>
              <span style={{fontSize:10, color:'#5a5a6e', ...mono}}>BT: {r.bt}</span>
              <span title={r.st.tip||''} style={{fontSize:18, fontWeight:700, color:r.st.col, cursor:r.st.tip?'help':'default'}}>{r.st.sym}</span>
            </div>
            <div style={{fontSize:14, fontWeight:700, color: r.live ? r.st.col : '#2a2a38', ...mono}}>
              {r.live || '—'}
              {r.live && closed.length < 30 && <span style={{fontSize:9,color:'#3e3e52',fontWeight:400,display:'block'}}>({closed.length} trades)</span>}
            </div>
          </div>
        ))}
      </div>
      {closed.length < 30 && (
        <div style={{marginTop:10, fontSize:10, color:'#3e3e52'}}>
          ⚠ Live sample: {closed.length} trades — comparisons reliable after 30+ trades
        </div>
      )}
    </div>
  );
}

function Overview({ data, viewMode, setViewMode, dateRange, simData, onStrategyClick }) {
  const { account, position, bot_state, trades, last_signal } = data;
  const stats  = { grades:{}, setupStats:{}, max_drawdown:0, return_pct:0, total_net_pnl:0, closed_trades:0, ...data.stats };
  const equity = data.equity?.length ? data.equity : [{ v: account.account_size }];
  const closed = trades.filter(t => !t.open);
  const returnColor = (stats.return_pct ?? 0) >= 0 ? '#00d084' : '#ff4d6d';

  // ── inject pulse keyframes once ────────────────────────────────────────────
  React.useEffect(() => {
    if (document.getElementById('ov-kf')) return;
    const s = document.createElement('style');
    s.id = 'ov-kf';
    s.textContent = '@keyframes ovPulse{0%,100%{opacity:.2;transform:scale(1)}50%{opacity:.9;transform:scale(1.6)}} @keyframes ovRing{0%,100%{opacity:.15;transform:scale(1)}50%{opacity:.4;transform:scale(2.2)}} @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} @keyframes spkDraw{from{stroke-dashoffset:3000}to{stroke-dashoffset:0}} .ab-card{transition:border-color 0.2s,box-shadow 0.2s}.ab-card:hover{border-color:rgba(247,147,26,0.3)!important;box-shadow:0 0 0 1px rgba(247,147,26,0.1)!important}';
    document.head.appendChild(s);
  }, []);

  // ── BTC live price + 24h change + futures basis ──────────────────────────
  const [btcPrice,       setBtcPrice]       = React.useState(0);
  const [btc24h,         setBtc24h]         = React.useState(null);
  const [futuresPrice,   setFuturesPrice]   = React.useState(null);
  const [futuresBasis,   setFuturesBasis]   = React.useState(null);
  const [futuresContract,setFuturesContract]= React.useState(null);
  React.useEffect(() => {
    const load = () => fetch('/api/ticker')
      .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
      .then(d => {
        if (!d || d.err) { console.error('[ticker] API error:', d?.err); return; }
        const price = parseFloat(d.price);
        if (price > 0) setBtcPrice(price);
        // API returns 'open' (24h open price) from /products/BTC-USD/stats
        const open24 = d.open || d.open_24h;
        if (open24 && price) {
          const o = parseFloat(open24), c = price;
          setBtc24h(o > 0 ? (c - o) / o * 100 : null);
        }
        if (d.futures_price)         setFuturesPrice(d.futures_price);
        if (d.futures_basis != null) setFuturesBasis(d.futures_basis);
        if (d.futures_contract)      setFuturesContract(d.futures_contract);
      }).catch(err => console.error('[ticker] fetch failed:', err));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // ── next scan countdown ────────────────────────────────────────────────────
  const [scanIn, setScanIn] = React.useState('—');
  React.useEffect(() => {
    const calc = () => {
      const intervalMs = (data.config.RUN_INTERVAL_MINUTES || 15) * 60000;
      const last = bot_state.last_daily_scan_day;
      if (!last) { setScanIn('—'); return; }
      try {
        const raw = last.includes('T') ? last : last.replace(' ', 'T') + ':00Z';
        const diff = new Date(raw).getTime() + intervalMs - Date.now();
        if (diff <= 0) { setScanIn('any moment'); return; }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setScanIn(`${m}m ${s}s`);
      } catch { setScanIn('—'); }
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [bot_state.last_daily_scan_day, data.config.RUN_INTERVAL_MINUTES]);

  // ── last Telegram message ─────────────────────────────────────────────────
  const [lastTg, setLastTg] = React.useState(null);
  React.useEffect(() => {
    fetch('/api/telegram').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.messages?.length) {
        const raw = d.messages[d.messages.length - 1].raw;
        setLastTg(stripTgPreview(raw) || raw);
      }
    }).catch(() => {});
  }, []);

  // ── market session ─────────────────────────────────────────────────────────
  const [sessions, setSessions] = React.useState(getMarketSessions());
  React.useEffect(() => {
    const id = setInterval(() => setSessions(getMarketSessions()), 60000);
    return () => clearInterval(id);
  }, []);

  // ── daily P&L ─────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = closed.filter(t => t.timestamp_exit?.startsWith(today));
  const dailyPnl    = todayTrades.reduce((s, t) => s + (parseFloat(t.pnl_net_usd) || 0), 0);

  const hasPosition = position.qty > 0;

  return (
    <div style={ovStyles.wrap}>

      {/* ── Header ── */}
      <div style={ovStyles.header}>
        <div>
          <div style={ovStyles.pageTitle}>Overview</div>
          <div style={ovStyles.pageSub}>
            {viewMode === 'sim'
              ? `Backtest simulation · $10k start · ${dateRange?.start?.slice(0,4) ?? '2017'}→${dateRange?.end?.slice(0,4) ?? 'now'}`
              : `BTC/USD · 20 strategies · Coinbase CFM · Run every ${data.config?.RUN_INTERVAL_MINUTES ?? 15}min`}
          </div>
        </div>
        <div style={{display:'flex', alignItems:'flex-start', gap:16}}>
          {viewMode !== undefined && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} dateRange={dateRange} />}
          <div style={ovStyles.btcBlock}>
          {/* Market session pills */}
          <div style={{display:'flex', justifyContent:'flex-end', gap:6, marginBottom:6}}>
            {sessions.map(s => (
              <span key={s.name} style={{fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
                background: `${s.color}18`, border:`1px solid ${s.color}40`, color:s.color, letterSpacing:'0.4px'}}>
                ● {s.name}
              </span>
            ))}
          </div>
          <span style={ovStyles.btcLabel}>BTC Spot Price</span>
          {btcPrice > 0
            ? <span style={ovStyles.btcVal}>${btcPrice.toLocaleString('en-US')}</span>
            : <span style={{...ovStyles.btcVal, color:'#ff4d6d', fontSize:16}}>Price feed error</span>}
          <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8, marginTop:2}}>
            {btc24h !== null && (
              <span style={{fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color: btc24h >= 0 ? '#00d084':'#ff4d6d'}}>
                {btc24h >= 0 ? '+':''}{btc24h.toFixed(2)}% 24h
              </span>
            )}
            <span style={{fontSize:11, color: btcPrice > 0 ? '#00d084' : '#ff4d6d', fontFamily:"'JetBrains Mono',monospace"}}>
              {btcPrice > 0 ? '● Live · 30s' : '● Reconnecting…'}
            </span>
          </div>
          {futuresPrice && (
            <div style={{marginTop:8, padding:'6px 10px', borderRadius:6, background:'rgba(167,139,250,0.08)', border:'1px solid rgba(167,139,250,0.2)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:11, color:'#a78bfa', fontFamily:"'Space Grotesk',sans-serif", fontWeight:600}}>
                  {futuresContract || 'Nano Futures'}
                </span>
                <span style={{fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2'}}>
                  ${futuresPrice.toLocaleString('en-US')}
                </span>
              </div>
              {futuresBasis != null && (
                <div style={{fontSize:11, color: futuresBasis >= 0 ? '#a78bfa' : '#ff4d6d', textAlign:'right', marginTop:2, fontFamily:"'JetBrains Mono',monospace"}}>
                  Basis {futuresBasis >= 0 ? '+':''}{futuresBasis.toLocaleString('en-US')} USD vs spot
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* ── Tier restriction alert ── */}
      {bot_state.tier_restricted && (
        <div style={ovStyles.alert}>
          ⚠️ Tier Restriction Active — Loss streak {bot_state.loss_streak}/3 reached · T1 entries only
        </div>
      )}

      {/* ── Daily P&L strip ── */}
      <div style={ovStyles.dailyStrip}>
        <span style={{fontSize:11, color:'#3e3e52', letterSpacing:'0.3px'}}>Today</span>
        <span style={{fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
          color: todayTrades.length === 0 ? '#3e3e52' : dailyPnl >= 0 ? '#00d084' : '#ff4d6d'}}>
          {todayTrades.length === 0 ? 'No trades closed today' : `${dailyPnl >= 0 ? '+' : ''}$${Math.abs(dailyPnl).toFixed(2)}`}
        </span>
        {todayTrades.length > 0 && (
          <span style={{fontSize:11, color:'#3e3e52'}}>· {todayTrades.length} trade{todayTrades.length > 1 ? 's':''} · {todayTrades.filter(t => (t.pnl_net_usd||0)>=0).length}W {todayTrades.filter(t => (t.pnl_net_usd||0)<0).length}L</span>
        )}
        <div style={{flex:1}}/>
        <span style={{fontSize:11, color:'#3e3e52'}}>Next scan</span>
        <span style={{fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#F7931A'}}>{scanIn}</span>
      </div>

      {/* ── KPI row ── */}
      <div style={ovStyles.kpiGrid}>
        <KpiCard label="Account Equity"   value={`$${(+account.equity).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} sub={`${(stats.return_pct||0) >= 0 ? '+':''}${(+(stats.return_pct||0)).toFixed(2)}% on $${(+account.account_size).toLocaleString('en-US')}`} subColor={returnColor} accent={returnColor} tooltip="Total account value — starting capital plus all closed P&L." />
        <KpiCard label="Buying Power"     value={`$${(+account.buying_power).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} sub="Available cash" tooltip="Cash available to open new positions (excludes margin held on open trades)." />
        <KpiCard label="Net PnL (closed)" value={`${(stats.total_net_pnl||0) >= 0 ? '+' : ''}$${(+(stats.total_net_pnl||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} sub={`${stats.closed_trades ?? 0} closed trades`} accent={(stats.total_net_pnl||0) >= 0 ? '#00d084':'#ff4d6d'} subColor="#5a5a6e" tooltip="Sum of all closed trade profits and losses after fees. Open positions not included." />
        <KpiCard label="Win Rate"         value={closed.length ? `${stats.win_rate}%` : '—'} sub={closed.length ? `${stats.wins}W · ${stats.losses}L` : 'No closed trades'} tooltip="Percentage of closed trades that finished in profit. Backtest target: ~54%." />
        <KpiCard label="Avg R Multiple"   value={closed.length ? `${stats.avg_r > 0 ? '+' : ''}${stats.avg_r.toFixed(2)}R` : '—'} sub={closed.length ? `Total: ${stats.total_r.toFixed(2)}R` : 'No closed trades'} accent={stats.avg_r >= 1 ? '#00d084' : closed.length ? '#ff4d6d' : '#3e3e52'} tooltip="Average reward earned per trade as a multiple of the amount risked. 1R = you risked $X and made $X. Backtest target: +0.46R." />
        <KpiCard label="Max Drawdown"     value={(() => { const dd = stats.max_drawdown ?? stats.max_dd_pct ?? 0; return closed.length ? `${dd > 0 ? '-' : ''}${Math.abs(dd).toFixed(1)}%` : '—'; })()} sub="From equity peak" accent={closed.length ? '#ff4d6d' : '#3e3e52'} tooltip="Largest peak-to-trough equity decline. Circuit breaker pauses all trading at -15%." />
      </div>

      {/* ── Mid row ── */}
      <div style={ovStyles.midRow}>

        {/* Open position */}
        <div className="ab-card" style={ovStyles.card}>
          <div style={ovStyles.cardHead}>
            <span style={ovStyles.cardTitle}>Open Position</span>
            {hasPosition && (
              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                <span style={{fontSize:9, color:'#3e3e52', letterSpacing:'0.5px'}}>QUALITY</span>
                <GradeBadge grade={bot_state.active_trade?.grade} />
                <span style={{fontSize:9, color:'#3e3e52', letterSpacing:'0.5px'}}>RISK</span>
                <TierBadge  tier={bot_state.active_trade?.tier} />
                <span style={{...ovStyles.sideBadge, background:'rgba(0,208,132,0.12)', color:'#00d084'}}>LONG</span>
              </div>
            )}
          </div>
          {hasPosition ? (
            <div style={ovStyles.posGrid}>
              <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Setup</span><span style={{...ovStyles.posVal, color:'#F7931A'}}>{bot_state.active_trade?.setup_type}</span></div>
              <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Qty</span><span style={ovStyles.posVal}>{position.qty} BTC</span></div>
              <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Entry</span><span style={ovStyles.posVal}>${(+position.avg_entry_price).toLocaleString('en-US')}</span></div>
              <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>SL / TP</span><span style={ovStyles.posVal}>${(+bot_state.active_trade?.sl_price).toLocaleString('en-US')} / ${(+bot_state.active_trade?.tp_price).toLocaleString('en-US')}</span></div>
              <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Max Risk</span><span style={ovStyles.posVal}>${bot_state.active_trade?.max_risk_usd} · R:R {bot_state.active_trade?.rr_target}×</span></div>
              <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Unrealised PnL</span><span style={{...ovStyles.posVal, color:'#00d084'}}>+${position.unrealized_pl.toFixed(2)}</span></div>
              {bot_state.active_trade?.partial_done && (
                <div style={{marginTop:8, padding:'7px 10px', borderRadius:6, background:'rgba(0,208,132,0.08)', border:'1px solid rgba(0,208,132,0.2)', fontSize:11, color:'#00d084', fontFamily:"'JetBrains Mono',monospace"}}>
                  🎯 50% closed at +1R · ${bot_state.active_trade?.partial_price?.toLocaleString('en-US')} · Remainder running to TP
                </div>
              )}
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:110, gap:10}}>
              {/* Pulse animation */}
              <div style={{position:'relative', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center'}}>
                <div style={{position:'absolute', width:36, height:36, borderRadius:'50%', border:'1.5px solid #F7931A', animation:'ovRing 2.5s ease-in-out infinite'}}/>
                <div style={{width:10, height:10, borderRadius:'50%', background:'#F7931A', animation:'ovPulse 2.5s ease-in-out infinite'}}/>
              </div>
              <span style={{fontSize:12, color:'#3e3e52'}}>No open position</span>
              <span style={{fontSize:11, color:'#2a2a38'}}>Bot is watching · next scan in <span style={{color:'#F7931A', fontFamily:"'JetBrains Mono',monospace"}}>{scanIn}</span></span>
            </div>
          )}
        </div>

        {/* Equity curve */}
        <div className="ab-card" style={ovStyles.card}>
          <div style={ovStyles.cardHead}>
            <span style={ovStyles.cardTitle}>Equity Curve</span>
            <span style={{fontSize:12, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace"}}>
              ${(+(account.account_size||0)).toLocaleString('en-US')}
              <span style={{color:'#3e3e52'}}> → </span>
              <span style={{color:'#00d084'}}>${(+(account.equity||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </span>
          </div>
          <SparkLine data={equity} color="#F7931A" height={100} />
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10, paddingTop:8, borderTop:'1px solid #1a1a22'}}>
            <div>
              <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:2}}>START</div>
              <div style={{fontSize:13, fontWeight:600, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace"}}>
                ${(+(equity[0]?.v||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
            </div>
            <div style={{fontSize:11, color:'#2a2a38'}}>{equity.length - 1} trades</div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:2}}>NOW</div>
              <div style={{fontSize:13, fontWeight:700, color:'#00d084', fontFamily:"'JetBrains Mono',monospace"}}>
                ${(+(equity[equity.length-1]?.v||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
            </div>
          </div>
        </div>

        {/* Bot state */}
        <div className="ab-card" style={ovStyles.card}>
          <div style={ovStyles.cardHead}><span style={ovStyles.cardTitle}>Bot State</span></div>
          <div style={ovStyles.posGrid}>
            <div style={ovStyles.posRow}>
              <span style={ovStyles.posLabel}>Loss Streak</span>
              <div style={{display:'flex', gap:4}}>
                {[1,2,3].map(n => (
                  <div key={n} style={{width:20, height:20, borderRadius:4, background: n <= bot_state.loss_streak ? '#ff4d6d' : '#1f1f28', border:'1px solid #2a2a38', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff', fontWeight:700}}>{n <= bot_state.loss_streak ? n : ''}</div>
                ))}
              </div>
            </div>
            <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Tier Restricted</span><span style={{...ovStyles.posVal, color: bot_state.tier_restricted ? '#ff4d6d':'#00d084'}}>{bot_state.tier_restricted ? 'YES — T1 only':'No'}</span></div>
            <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Trade Pending</span><span style={{...ovStyles.posVal, color: bot_state.trade_pending ? '#F7931A':'#5a5a6e'}}>{bot_state.trade_pending ? 'Waiting entry':'None'}</span></div>
            <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Next Scan</span><span style={{...ovStyles.posVal, color:'#F7931A'}}>{scanIn}</span></div>
            <div style={ovStyles.posRow}><span style={ovStyles.posLabel}>Last Scan</span><span style={{...ovStyles.posVal, fontSize:11}}>{bot_state.last_daily_scan_day}</span></div>
            {/* Last Telegram message */}
            {lastTg && (
              <div style={{marginTop:6, paddingTop:8, borderTop:'1px solid #1a1a22'}}>
                <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', marginBottom:4}}>LAST TELEGRAM</div>
                <div style={{fontSize:11, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace", lineHeight:1.5,
                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%'}}
                  title={lastTg}>
                  {lastTg.length > 72 ? lastTg.slice(0, 72) + '…' : lastTg}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bot vs Model comparison ── */}
      <ComparisonWidget stats={stats} trades={trades} />

      {/* ── Bottom row ── */}
      <div style={ovStyles.bottomRow}>
        <div className="ab-card" style={ovStyles.card}>
          <div style={ovStyles.cardHead}>
            <div>
              <span style={ovStyles.cardTitle}>Trade Quality</span>
              <div style={{fontSize:10, color:'#2a2a38', marginTop:3}}>A+ &gt;65% · Solid 55–65% · B 45–55% historical WR</div>
            </div>
          </div>
          {closed.length > 0 && Object.keys(stats.grades).length > 0 ? (
            <div style={{display:'flex', gap:12, marginTop:4}}>
              {Object.entries(stats.grades).map(([g, n]) => (
                <div key={g} style={{textAlign:'center'}}>
                  <GradeBadge grade={g} />
                  <div style={{fontSize:20, fontWeight:700, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace", marginTop:8}}>{n}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{fontSize:12, color:'#2a2a38', marginTop:16}}>{closed.length > 0 ? 'Grade data not tracked in backtest' : 'No closed trades yet'}</div>
          )}
        </div>

        <div className="ab-card" style={{...ovStyles.card, flex:2}}>
          <div style={ovStyles.cardHead}>
            <span style={ovStyles.cardTitle}>Win Rates by Setup</span>
            {closed.length > 0 && <span style={{fontSize:11,color:'#3e3e52'}}>{Object.keys(stats.setupStats).length} strategies · {closed.length} trades</span>}
          </div>
          {closed.length > 0 ? (
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))', gap:8, marginTop:4}}>
              {Object.entries(stats.setupStats).sort(([,a],[,b]) => (b.w/(b.w+b.l)||0) - (a.w/(a.w+a.l)||0)).map(([type, s]) =>
                <SetupStatCard key={type} type={type} s={s} />
              )}
            </div>
          ) : (
            <div style={{display:'flex', alignItems:'center', justifyContent:'center', height:80}}>
              <span style={{fontSize:12, color:'#2a2a38'}}>Win rates populate after the first closed trade</span>
            </div>
          )}
        </div>

        <div className="ab-card" style={ovStyles.card}>
          <div style={ovStyles.cardHead}><span style={ovStyles.cardTitle}>Last Signal</span></div>
          {(() => {
            // Use real bot_state signal info — last_signal from MOCK is placeholder
            const bar = bot_state.last_signal_bar;
            if (!bar) return (
              <div style={{fontSize:12, color:'#2a2a38', marginTop:16, textAlign:'center'}}>No signals fired yet</div>
            );
            // Parse "T1f_H4_willy_rev_short_4h_2026-05-11 20:00:00+00:00"
            const parts = bar.split('_4h_');
            const stratRaw = parts[0] || bar;
            const tsRaw    = parts[1] || '';
            const stratName = STRAT_NAMES[stratRaw.toLowerCase()] || stratRaw.replace(/_/g,' ');
            let daysAgo = '';
            try {
              const d = new Date(tsRaw.trim());
              const diff = Math.round((Date.now() - d.getTime()) / 86400000);
              daysAgo = diff === 0 ? 'today' : diff === 1 ? '1 day ago' : `${diff} days ago`;
            } catch {}
            return (
              <div style={ovStyles.posGrid}>
                <div style={ovStyles.posRow}>
                  <span style={ovStyles.posLabel}>Setup</span>
                  <span style={{...ovStyles.posVal, color:'#F7931A', fontSize:11}}>{stratName}</span>
                </div>
                <div style={ovStyles.posRow}>
                  <span style={ovStyles.posLabel}>When</span>
                  <span style={{...ovStyles.posVal, fontSize:11}}>{daysAgo}</span>
                </div>
                <div style={ovStyles.posRow}>
                  <span style={ovStyles.posLabel}>Current mkt</span>
                  <span style={{fontSize:11, color:'#5a5a6e'}}>Not aligned for entry</span>
                </div>
                <div style={{marginTop:4, paddingTop:6, borderTop:'1px solid #1a1a22'}}>
                  <div style={{fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:5}}>CURRENT FILTERS</div>
                  {[
                    { label:'Loss streak', val:`${bot_state.loss_streak || 0}/3`, warn: (bot_state.loss_streak || 0) >= 3 },
                    { label:'Portfolio DD', val:`${(bot_state.portfolio_dd_pct || 0).toFixed(1)}%`, warn: (bot_state.portfolio_dd_pct || 0) <= -10 },
                    { label:'Tier lock', val: bot_state.tier_restricted ? 'T1 only' : 'None', warn: bot_state.tier_restricted },
                    { label:'T3 DD pause', val: bot_state.tier3_paused ? 'Active' : 'Off', warn: bot_state.tier3_paused },
                  ].map(({ label, val, warn }) => (
                    <div key={label} style={{display:'flex', justifyContent:'space-between', marginBottom:3}}>
                      <span style={{fontSize:10, color:'#2a2a38'}}>{label}</span>
                      <span style={{fontSize:10, fontFamily:"'JetBrains Mono',monospace", color: warn ? '#ff4d6d' : '#3e3e52'}}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Strategy Health ── */}
      <div style={{marginTop:16}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
          <span style={{fontSize:13, fontWeight:600, color:'#ece9e2'}}>Strategy Health</span>
          <span style={{fontSize:11, color:'#3e3e52'}}>{OV_ACTIVE_STRATS.length} active strategies · click to view trades</span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8}}>
          {OV_ACTIVE_STRATS.map(type => (
            <StratHealthCard
              key={type}
              type={type}
              trades={trades}
              btWR={(() => {
                const btSS = simData?.stats?.setupStats;
                if (btSS?.[type]) {
                  const s = btSS[type];
                  return s.w+s.l > 0 ? Math.round(s.w/(s.w+s.l)*100) : null;
                }
                return OV_STRAT_BT_WR[type.toLowerCase()] || null;
              })()}
              tierRestricted={bot_state.tier_restricted}
              onNavigate={onStrategyClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const ovStyles = {
  wrap:       { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  header:     { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 },
  pageTitle:  { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  pageSub:    { fontSize:12, color:'#3e3e52', marginTop:4 },
  btcBlock:   { textAlign:'right', display:'flex', flexDirection:'column' },
  btcLabel:   { fontSize:11, color:'#5a5a6e', letterSpacing:'0.5px' },
  btcVal:     { fontSize:24, fontWeight:700, color:'#F7931A', fontFamily:"'JetBrains Mono',monospace" },
  alert:      { background:'rgba(255,77,109,0.08)', border:'1px solid rgba(255,77,109,0.25)', borderRadius:8, padding:'10px 16px', fontSize:13, color:'#ff4d6d', marginBottom:12 },
  dailyStrip: { display:'flex', alignItems:'center', gap:10, background:'#111116', border:'1px solid #1f1f28', borderRadius:8, padding:'9px 16px', marginBottom:14, fontSize:13 },
  kpiGrid:    { display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12, marginBottom:16 },
  kpiCard:    { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'16px 18px' },
  kpiLabel:   { fontSize:11, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:8 },
  kpiValue:   { fontSize:24, fontWeight:700, color:'#ece9e2', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  kpiSub:     { fontSize:11, color:'#5a5a6e', marginTop:4 },
  midRow:     { display:'grid', gridTemplateColumns:'1.1fr 1fr 1fr', gap:12, marginBottom:16 },
  bottomRow:  { display:'grid', gridTemplateColumns:'180px 1fr 200px', gap:12 },
  card:       { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 20px' },
  cardHead:   { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 },
  cardTitle:  { fontSize:13, fontWeight:600, color:'#ece9e2', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 },
  sideBadge:  { fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:4, letterSpacing:'0.5px' },
  posGrid:    { display:'flex', flexDirection:'column', gap:9 },
  posRow:     { display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 },
  posLabel:   { fontSize:12, color:'#3e3e52', flexShrink:0 },
  posVal:     { fontSize:12, fontWeight:600, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace", textAlign:'right' },
};

Object.assign(window, { Overview, GradeBadge, TierBadge, STRAT_NAMES });
