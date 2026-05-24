/*
  AlphaBrain v4 — P&L Ledger
  Reads ONLY from /api/brain/trades and /api/brain/state.
  Completely isolated from AlphaBot ledger — DO NOT mix data sources.
*/

const BL_ACCENT  = '#a78bfa';
const BRAIN_START = 1000;

// Backtest baseline for comparison
const BASELINE = { cagr: 9.6, wr: 21.7, avgR: 0.502, tradesPerYear: 8.7, maxDD: -25.1 };

function BrainLedger() {
  const [trades, setTrades]       = React.useState([]);
  const [brainState, setBrainState] = React.useState(null);
  const [loading, setLoading]     = React.useState(true);

  React.useEffect(() => {
    Promise.all([
      fetch('/api/brain/trades').then(r => r.ok ? r.json() : { trades: [] }).catch(() => ({ trades: [] })),
      fetch('/api/brain/state').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([tRes, stRes]) => {
      setTrades(tRes.trades || []);
      if (stRes && !stRes.err) setBrainState(stRes);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // ── Compute stats ────────────────────────────────────────────────────────────
  const closed = React.useMemo(() => {
    return trades.filter(t => !t.open)
      .sort((a, b) => (a.timestamp_exit || '').localeCompare(b.timestamp_exit || ''));
  }, [trades]);

  const stats = React.useMemo(() => {
    if (!closed.length) return null;
    const rs   = closed.map(t => parseFloat(t.r_multiple || 0));
    const pnls = closed.map(t => parseFloat(t.pnl_usd || 0));
    const wins = rs.filter(r => r > 0);
    const totalR  = rs.reduce((s, r) => s + r, 0);
    const totalPnl = pnls.reduce((s, p) => s + p, 0);

    // Equity curve + max drawdown
    let bal = BRAIN_START, peak = BRAIN_START, maxDD = 0;
    const curve = [BRAIN_START];
    closed.forEach(t => {
      bal += parseFloat(t.pnl_usd || 0);
      if (bal > peak) peak = bal;
      const dd = peak > 0 ? (bal - peak) / peak * 100 : 0;
      if (dd < maxDD) maxDD = dd;
      curve.push(Math.round(bal * 100) / 100);
    });

    // CAGR: find date range
    let cagrPct = null;
    const firstDate = closed[0]?.timestamp_entry;
    const lastDate  = closed[closed.length - 1]?.timestamp_exit || closed[closed.length - 1]?.timestamp_entry;
    if (firstDate && lastDate) {
      const years = (new Date(lastDate) - new Date(firstDate)) / (365.25 * 86400e3);
      if (years > 0) cagrPct = (Math.pow(bal / BRAIN_START, 1 / years) - 1) * 100;
    }

    return {
      count:   closed.length,
      wins:    wins.length,
      wr:      Math.round(wins.length / closed.length * 100),
      totalR:  +totalR.toFixed(2),
      avgR:    +(totalR / closed.length).toFixed(3),
      totalPnl: +totalPnl.toFixed(2),
      finalEq: +bal.toFixed(2),
      maxDD:   +maxDD.toFixed(1),
      cagrPct: cagrPct !== null ? +cagrPct.toFixed(1) : null,
      curve,
      returnPct: +((bal - BRAIN_START) / BRAIN_START * 100).toFixed(2),
    };
  }, [closed]);

  if (loading) return (
    <div style={{padding:40, color:'#5a5a6e', fontFamily:"'Space Grotesk',sans-serif"}}>Loading…</div>
  );

  const equity = brainState?.equity || BRAIN_START;

  return (
    <div style={blS.page}>
      {/* Header */}
      <div style={blS.header}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <span style={{fontSize:20, color:BL_ACCENT}}>◑</span>
          <div>
            <div style={blS.title}>Brain Ledger</div>
            <div style={blS.subtitle}>AlphaBrain v4 P&amp;L · $1,000 paper account · isolated from AlphaBot</div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:24, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                       color: equity >= BRAIN_START ? '#00d084' : '#ff4d6d'}}>
            ${equity.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}
          </div>
          <div style={{fontSize:10, color:'#3e3e52', marginTop:2}}>Current Brain Equity</div>
        </div>
      </div>

      {/* Empty state */}
      {!stats ? (
        <div style={{padding:'60px 24px', textAlign:'center'}}>
          <div style={{fontSize:40, color:'#1f1f28', marginBottom:16}}>◑</div>
          <div style={{fontSize:14, color:'#5a5a6e', marginBottom:8}}>No closed Brain trades yet</div>
          <div style={{fontSize:12, color:'#3e3e52'}}>
            brain_trades.csv will be created on first signal. Backtest baseline: {BASELINE.cagr}% CAGR over 8.7 trades/year.
          </div>
        </div>
      ) : (
        <>
          {/* Live vs Baseline comparison */}
          <div style={blS.section}>
            <div style={blS.sectionTitle}>Performance vs Backtest Baseline</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:12}}>
              {[
                { label:'CAGR',        live: stats.cagrPct !== null ? stats.cagrPct + '%' : '—',   base: BASELINE.cagr + '%',  liveNum: stats.cagrPct, baseNum: BASELINE.cagr, higherIsBetter:true },
                { label:'Win Rate',    live: stats.wr + '%',  base: BASELINE.wr + '%',   liveNum: stats.wr,      baseNum: BASELINE.wr,   higherIsBetter:true },
                { label:'Avg R',       live: stats.avgR,      base: BASELINE.avgR,       liveNum: stats.avgR,    baseNum: BASELINE.avgR, higherIsBetter:true },
                { label:'Max DD',      live: stats.maxDD + '%', base: BASELINE.maxDD + '%', liveNum: stats.maxDD, baseNum: BASELINE.maxDD, higherIsBetter:false },
                { label:'Trade Count', live: stats.count,     base: '—',                 liveNum: null,          baseNum: null,          higherIsBetter:true },
              ].map(({ label, live, base, liveNum, baseNum, higherIsBetter }) => {
                const beating = liveNum !== null && baseNum !== null
                  ? (higherIsBetter ? liveNum >= baseNum : liveNum >= baseNum)
                  : null;
                return (
                  <div key={label} style={blS.compCard}>
                    <div style={blS.compLabel}>{label}</div>
                    <div style={{...blS.compLive,
                      color: beating === null ? '#ece9e2' : beating ? '#00d084' : '#ff4d6d'}}>
                      {live}
                    </div>
                    <div style={blS.compBase}>Base: {base}</div>
                    {beating !== null && (
                      <div style={{fontSize:9, color: beating ? '#00d084' : '#ff4d6d', marginTop:2}}>
                        {beating ? 'ON TRACK' : 'BELOW BASE'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Equity mini-chart */}
          <div style={blS.section}>
            <div style={blS.sectionTitle}>Equity Curve — ${BRAIN_START.toLocaleString()} start</div>
            <BrainEquityCurve curve={stats.curve} start={BRAIN_START} />
          </div>

          {/* Per-trade R log */}
          <div style={blS.section}>
            <div style={blS.sectionTitle}>Trade Log</div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                <thead>
                  <tr>
                    {['#','Date','Dir','Level','Entry','Exit','R','P&L','Reason'].map(h => (
                      <th key={h} style={blS.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...closed].reverse().map((t, i) => {
                    const r = parseFloat(t.r_multiple || 0);
                    const pnl = parseFloat(t.pnl_usd || 0);
                    return (
                      <tr key={t.trade_id || i} style={{background: i % 2 === 0 ? '#0d0d11' : 'transparent'}}>
                        <td style={blS.td}>{closed.length - i}</td>
                        <td style={{...blS.td, color:'#5a5a6e', fontSize:10}}>
                          {(t.timestamp_exit || t.timestamp_entry || '').slice(0,10)}
                        </td>
                        <td style={{...blS.td, color: t.direction === 'LONG' ? '#00d084' : '#ff4d6d', fontWeight:600}}>
                          {t.direction}
                        </td>
                        <td style={{...blS.td, fontSize:10, color:'#5a5a6e'}}>
                          {(t.level_type || '').replace(/_/g,' ')}
                        </td>
                        <td style={{...blS.td, fontFamily:"'JetBrains Mono',monospace"}}>
                          {t.entry ? `$${parseFloat(t.entry).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'}
                        </td>
                        <td style={{...blS.td, fontFamily:"'JetBrains Mono',monospace"}}>
                          {t.exit_price ? `$${parseFloat(t.exit_price).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'}
                        </td>
                        <td style={{...blS.td, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                                     color: r > 0 ? '#00d084' : r < 0 ? '#ff4d6d' : '#5a5a6e'}}>
                          {(r >= 0 ? '+' : '') + r.toFixed(2)}R
                        </td>
                        <td style={{...blS.td, fontFamily:"'JetBrains Mono',monospace",
                                     color: pnl >= 0 ? '#00d084' : '#ff4d6d'}}>
                          {(pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toFixed(2)}
                        </td>
                        <td style={{...blS.td, fontSize:10, color:'#5a5a6e'}}>{t.exit_reason || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BrainEquityCurve({ curve, start }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || curve.length < 2) return;
    const W = canvas.offsetWidth || 600;
    const H = 100;
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const min  = Math.min(...curve);
    const max  = Math.max(...curve);
    const span = max - min || 1;
    const pad  = 8;
    const xs   = (i) => pad + (i / (curve.length - 1)) * (W - pad * 2);
    const ys   = (v) => H - pad - ((v - min) / span) * (H - pad * 2);

    // Baseline
    const by = ys(start);
    ctx.strokeStyle = '#2a2a38';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(W, by); ctx.stroke();
    ctx.setLineDash([]);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(167,139,250,0.25)');
    grad.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xs(0), ys(curve[0]));
    curve.forEach((v, i) => ctx.lineTo(xs(i), ys(v)));
    ctx.lineTo(xs(curve.length - 1), H);
    ctx.lineTo(xs(0), H);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(xs(0), ys(curve[0]));
    curve.forEach((v, i) => ctx.lineTo(xs(i), ys(v)));
    ctx.stroke();
  }, [curve, start]);

  return (
    <canvas ref={ref} style={{width:'100%', height:100, borderRadius:6,
                               display:'block', background:'#0d0d11'}} />
  );
}

const blS = {
  page: { flex:1, fontFamily:"'Space Grotesk',sans-serif", overflowY:'auto' },
  header: {
    display:'flex', justifyContent:'space-between', alignItems:'flex-start',
    padding:'24px 24px 16px', borderBottom:'1px solid #1f1f28',
  },
  title: { fontSize:18, fontWeight:700, color:'#ece9e2' },
  subtitle: { fontSize:11, color:'#5a5a6e', marginTop:3 },
  section: { padding:'20px 24px', borderBottom:'1px solid #1a1a22' },
  sectionTitle: { fontSize:11, color:'#3e3e52', letterSpacing:'0.5px', textTransform:'uppercase',
                  fontWeight:600, marginBottom:14 },
  compCard: { background:'#111116', border:'1px solid #1f1f28', borderRadius:8,
               padding:'12px 14px' },
  compLabel: { fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:6,
                textTransform:'uppercase' },
  compLive: { fontSize:22, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
               marginBottom:2 },
  compBase: { fontSize:10, color:'#3e3e52' },
  th: { padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:600,
         color:'#3e3e52', letterSpacing:'0.5px', textTransform:'uppercase',
         borderBottom:'1px solid #1f1f28' },
  td: { padding:'8px 10px', borderBottom:'1px solid #0f0f14', color:'#ece9e2' },
};

Object.assign(window, { BrainLedger });
