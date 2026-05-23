
function Strategy({ data }) {
  const [cfg, setCfg]           = React.useState({ ...data.config });
  const [saved, setSaved]       = React.useState(false);
  const [confirmSave, setConfirmSave] = React.useState(false);
  const [previewEntry, setPreviewEntry] = React.useState(95000);
  const [previewAtr,   setPreviewAtr]   = React.useState(1415);

  const set       = (k, v)            => { setCfg(p => ({ ...p, [k]: v }));                          setSaved(false); };
  const setNested = (field, key, v)   => { setCfg(p => ({ ...p, [field]: { ...p[field], [key]: v } })); setSaved(false); };

  const equity = cfg.ACCOUNT_SIZE || data.account.equity;

  const Field = ({ label, k, min, max, step=1, note }) => (
    <div style={sStyles.field}>
      <div>
        <div style={sStyles.label}>{label}</div>
        {note && <div style={sStyles.note}>{note}</div>}
      </div>
      <input type="number" value={cfg[k] ?? ''} min={min} max={max} step={step}
        onChange={e => set(k, +e.target.value)} style={sStyles.input} />
    </div>
  );

  const Select = ({ label, k, options, note }) => (
    <div style={sStyles.field}>
      <div>
        <div style={sStyles.label}>{label}</div>
        {note && <div style={sStyles.note}>{note}</div>}
      </div>
      <select value={cfg[k]} onChange={e => set(k, e.target.value)} style={sStyles.select}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div style={sStyles.wrap}>
      {/* Header */}
      <div style={sStyles.header}>
        <div>
          <div style={sStyles.pageTitle}>Strategy Config</div>
          <div style={sStyles.pageSub}>signal_engine/config.py · {cfg.SYMBOL} · {cfg.PRIMARY_TF?.toUpperCase()}</div>
        </div>
        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6}}>
          {confirmSave ? (
            <div style={{background:'rgba(255,77,109,0.06)', border:'1px solid rgba(255,77,109,0.3)', borderRadius:8, padding:'12px 16px', textAlign:'right', minWidth:280}}>
              <div style={{fontSize:12, fontWeight:700, color:'#ff4d6d', marginBottom:6}}>⚠ Confirm save?</div>
              <div style={{fontSize:11, color:'#5a5a6e', marginBottom:10, lineHeight:1.5}}>This updates your local config view.<br/>It does <b>not</b> push to the live bot.</div>
              <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                <button onClick={() => setConfirmSave(false)}
                  style={{padding:'6px 14px', borderRadius:6, border:'1px solid #1f1f28', background:'#0d0d11', color:'#5a5a6e', fontSize:11, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif"}}>
                  Cancel
                </button>
                <button onClick={() => { setSaved(true); setConfirmSave(false); }}
                  style={{padding:'6px 14px', borderRadius:6, border:'1px solid rgba(0,208,132,0.3)', background:'rgba(0,208,132,0.12)', color:'#00d084', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif"}}>
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={() => setConfirmSave(true)}
                style={{...sStyles.saveBtn, ...(saved ? {background:'rgba(0,208,132,0.12)', color:'#00d084', border:'1px solid rgba(0,208,132,0.3)'} : {})}}>
                {saved ? '✓ Saved locally' : 'Save Changes'}
              </button>
              <div style={{fontSize:10, color:'#2a2a38', fontStyle:'italic'}}>visual only — does not push to live bot</div>
            </>
          )}
        </div>
      </div>

      <div style={sStyles.grid}>

        {/* Symbol & Timing */}
        <div style={sStyles.section}>
          <div style={sStyles.sectionTitle}>Symbol & Timing</div>
          <Select label="Primary Timeframe" k="PRIMARY_TF" options={['1h','4h','1d']} note="main chart the bot reads" />
          <Field  label="OHLCV Limit"       k="OHLCV_LIMIT" min={100} max={2000} step={10} note="bars to fetch from exchange" />
          <Field  label="Scan Interval (min)" k="RUN_INTERVAL_MINUTES" min={1} max={60} note="how often bot checks for signals" />
          <div style={sStyles.field}>
            <div>
              <div style={sStyles.label}>Morning Brief Time</div>
              <div style={sStyles.note}>daily Telegram summary (UTC)</div>
            </div>
            <input type="text" value={cfg.MORNING_BRIEF_LOCAL}
              onChange={e => set('MORNING_BRIEF_LOCAL', e.target.value)}
              style={{...sStyles.input, width:72}} />
          </div>
          <div style={{...sStyles.field, marginTop:4}}>
            <div style={sStyles.label}>Symbol</div>
            <span style={{fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:'#F7931A'}}>{cfg.SYMBOL}</span>
          </div>
        </div>

        {/* EMA & Indicators */}
        <div style={sStyles.section}>
          <div style={sStyles.sectionTitle}>Trend Indicators</div>
          <Field label="EMA Fast" k="EMA_FAST" min={5} max={200} note="short moving avg — short-term trend" />
          <Field label="EMA Slow" k="EMA_SLOW" min={10} max={500} note="long moving avg — main trend filter" />
          <div style={sStyles.divider} />
          <div style={{...sStyles.sectionTitle, marginTop:12}}>ATR & RSI</div>
          <Field label="ATR Period" k="ATR_LEN" min={5} max={50} note="measures volatility — used for SL sizing" />
          <Field label="RSI Period" k="RSI_LEN" min={5} max={50} note="momentum oscillator — detects extremes" />
        </div>

        {/* Entry Filters */}
        <div style={sStyles.section}>
          <div style={sStyles.sectionTitle}>Entry Filters</div>
          <Field label="Volume Spike Multiplier" k="VOL_SPIKE_MULT" min={1} max={5} step={0.1}
            note="volume must be this × 20-bar average to confirm entry" />
          <div style={sStyles.divider} />
          <div style={{...sStyles.sectionTitle, marginTop:12}}>Swing Detection</div>
          <Field label="Swing Lookback (bars)" k="SWING_BARS" min={3} max={50}
            note="bars used to identify swing highs and lows for pattern detection" />
        </div>

        {/* Time Exits */}
        <div style={sStyles.section}>
          <div style={sStyles.sectionTitle}>Time Exits (bars)</div>
          <div style={{fontSize:11, color:'#3e3e52', marginBottom:14, lineHeight:1.5}}>
            If a trade hasn't hit TP or SL after this many bars it closes automatically — prevents capital being tied up indefinitely.
          </div>
          <Field label="Weekly setups" k="TIME_EXIT_WEEKLY" min={1} max={50}  note="weekly pattern · 1 bar = 1 week" />
          <Field label="Daily setups"  k="TIME_EXIT_DAILY"  min={1} max={100} note="daily pattern · 1 bar = 1 day" />
          <Field label="4H setups"     k="TIME_EXIT_H4"     min={1} max={200} note="4-hour pattern · 1 bar = 4 hours" />
          <Field label="1H setups"     k="TIME_EXIT_H1"     min={1} max={200} note="1-hour pattern · 1 bar = 1 hour" />
        </div>

        {/* Risk per trade — spans 2 cols */}
        <div style={{...sStyles.section, gridColumn:'span 2'}}>
          <div style={sStyles.sectionTitle}>Risk Per Trade & Drawdown Protection</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12}}>

            {[1,2,3].map(tier => {
              const labels = {1:'High conviction', 2:'Medium conviction', 3:'Speculative'};
              return (
                <div key={tier} style={{background:'#0d0d11', borderRadius:8, padding:'14px 16px', border:'1px solid #1a1a22'}}>
                  <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:4}}>
                    <TierBadge tier={tier} />
                  </div>
                  <div style={{fontSize:11, color:'#3e3e52', marginBottom:12}}>{labels[tier]}</div>
                  <div style={sStyles.field}>
                    <div>
                      <div style={sStyles.label}>Risk %</div>
                      <div style={sStyles.note}>${(equity * (cfg.TIER_RISK_PCT?.[tier] ?? 0) / 100).toFixed(0)} now</div>
                    </div>
                    <input type="number" value={cfg.TIER_RISK_PCT?.[tier] ?? ''} min={0.5} max={20} step={0.5}
                      onChange={e => setNested('TIER_RISK_PCT', tier, +e.target.value)} style={sStyles.input} />
                  </div>
                  <div style={sStyles.field}>
                    <div>
                      <div style={sStyles.label}>Min R:R</div>
                      <div style={sStyles.note}>reject if below this</div>
                    </div>
                    <input type="number" value={cfg.TIER_RR?.[tier] ?? ''} min={0.5} max={10} step={0.5}
                      onChange={e => setNested('TIER_RR', tier, +e.target.value)} style={sStyles.input} />
                  </div>
                </div>
              );
            })}

            {/* DD Filter */}
            <div style={{background:'rgba(255,77,109,0.04)', borderRadius:8, padding:'14px 16px', border:'1px solid rgba(255,77,109,0.12)'}}>
              <div style={{fontSize:10, fontWeight:700, color:'#ff4d6d', letterSpacing:'0.5px', marginBottom:4}}>DD FILTER</div>
              <div style={{fontSize:11, color:'#3e3e52', marginBottom:12}}>Drawdown protection</div>
              <div style={sStyles.field}>
                <div>
                  <div style={sStyles.label}>Max Portfolio DD %</div>
                  <div style={sStyles.note}>pauses a tier when breached</div>
                </div>
                <input type="number" value={cfg.DD_FILTER_PCT ?? ''} min={-50} max={0} step={1}
                  onChange={e => set('DD_FILTER_PCT', +e.target.value)} style={sStyles.input} />
              </div>
              <div style={sStyles.field}>
                <div>
                  <div style={sStyles.label}>Pauses Tier</div>
                  <div style={sStyles.note}>1–3 · paused when DD hit</div>
                </div>
                <input type="number" value={cfg.DD_FILTER_PAUSES_TIER ?? ''} min={1} max={3} step={1}
                  onChange={e => set('DD_FILTER_PAUSES_TIER', +e.target.value)} style={sStyles.input} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Preview */}
      <div style={sStyles.riskCard}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18}}>
          <div>
            <div style={{fontSize:13, fontWeight:600, color:'#ece9e2', marginBottom:4}}>Risk Preview</div>
            <div style={{fontSize:11, color:'#3e3e52'}}>
              Estimates SL/TP/qty for each tier — SL distance = 1× ATR. Adjust entry price and ATR to match current market.
            </div>
          </div>
          <div style={{display:'flex', gap:10}}>
            <div>
              <div style={sStyles.note}>Entry Price ($)</div>
              <input type="number" value={previewEntry} onChange={e => setPreviewEntry(+e.target.value)}
                style={{...sStyles.input, width:110, marginTop:4}} />
            </div>
            <div>
              <div style={sStyles.note}>ATR Estimate ($)</div>
              <input type="number" value={previewAtr} onChange={e => setPreviewAtr(+e.target.value)}
                style={{...sStyles.input, width:110, marginTop:4}} />
            </div>
          </div>
        </div>

        <div style={{display:'flex', gap:0}}>
          {[1,2,3].map(tier => {
            const riskUsd = equity * (cfg.TIER_RISK_PCT?.[tier] ?? 0) / 100;
            const slDist  = previewAtr;
            const tpDist  = slDist * (cfg.TIER_RR?.[tier] ?? 1);
            const slPrice = previewEntry - slDist;
            const tpPrice = previewEntry + tpDist;
            const qty     = slDist > 0 ? riskUsd / slDist : 0;
            const slPct   = previewEntry > 0 ? (slDist / previewEntry * 100) : 0;
            const fmt     = n => n.toLocaleString('en-US', {maximumFractionDigits:0});
            return (
              <div key={tier} style={{flex:1, padding:'0 22px', borderRight: tier<3?'1px solid #1a1a22':'none'}}>
                <div style={{display:'flex', gap:8, marginBottom:12, alignItems:'center'}}>
                  <TierBadge tier={tier} />
                  <span style={{fontSize:11, color:'#5a5a6e'}}>${riskUsd.toFixed(0)} at risk · {cfg.TIER_RISK_PCT?.[tier]}%</span>
                </div>
                <div style={{fontSize:11, color:'#3e3e52', marginBottom:3}}>Stop Loss</div>
                <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ff4d6d', marginBottom:2}}>${fmt(slPrice)}</div>
                <div style={{fontSize:11, color:'#5a5a6e', marginBottom:14}}>{slPct.toFixed(2)}% below entry · ${fmt(slDist)} distance</div>
                <div style={{fontSize:11, color:'#3e3e52', marginBottom:3}}>Take Profit</div>
                <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#00d084', marginBottom:2}}>${fmt(tpPrice)}</div>
                <div style={{fontSize:11, color:'#5a5a6e', marginBottom:14}}>R:R 1 : {cfg.TIER_RR?.[tier]}</div>
                <div style={{fontSize:11, color:'#3e3e52', marginBottom:3}}>Est. Position Size</div>
                <div style={{fontSize:15, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2'}}>{qty.toFixed(6)} BTC</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const sStyles = {
  wrap:         { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  header:       { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22 },
  pageTitle:    { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  pageSub:      { fontSize:12, color:'#3e3e52', marginTop:4 },
  saveBtn:      { padding:'10px 22px', borderRadius:8, border:'1px solid rgba(247,147,26,0.3)', background:'rgba(247,147,26,0.12)', color:'#F7931A', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif", transition:'all 0.2s' },
  grid:         { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:14 },
  section:      { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 20px' },
  sectionTitle: { fontSize:10, fontWeight:700, color:'#3e3e52', letterSpacing:'1px', textTransform:'uppercase', marginBottom:14 },
  field:        { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12, gap:8 },
  label:        { fontSize:12, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace" },
  note:         { fontSize:10, color:'#2a2a38', marginTop:2 },
  input:        { width:80, background:'#0d0d11', border:'1px solid #1f1f28', borderRadius:6, padding:'5px 8px', color:'#ece9e2', fontSize:12, fontFamily:"'JetBrains Mono',monospace", textAlign:'right', outline:'none', flexShrink:0, boxSizing:'border-box' },
  select:       { background:'#0d0d11', border:'1px solid #1f1f28', borderRadius:6, padding:'5px 8px', color:'#F7931A', fontSize:12, outline:'none', cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" },
  divider:      { height:'1px', background:'#1a1a22', margin:'12px 0 4px' },
  riskCard:     { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'20px 24px' },
};

Object.assign(window, { Strategy });
