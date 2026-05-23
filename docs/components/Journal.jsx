
// ── Helpers ───────────────────────────────────────────────────────────────────

// Strategy config (sl fraction, rr, side) for backtest SL/TP estimation
const _STRAT_CFG = {
  't1a_w_fail_brkdn_long':      { sl:0.08,  rr:3.0,  side:'long'  },
  't1b_w_rsi_os_long':          { sl:0.10,  rr:3.0,  side:'long'  },
  't1c_d_sstar_short':          { sl:0.05,  rr:3.0,  side:'short' },
  't1d_h4_sweep_hi_short':      { sl:0.03,  rr:3.0,  side:'short' },
  't1e_w_oversold_hammer_long': { sl:0.08,  rr:2.5,  side:'long'  },
  't1f_h4_willy_rev_short':     { sl:0.03,  rr:3.0,  side:'short' },
  't2c_w_bull_engulf_long':     { sl:0.06,  rr:3.0,  side:'long'  },
  't1g_h4_vol_surge_long':      { sl:0.03,  rr:3.0,  side:'long'  },
  't1h_h4_vol_surge_short':     { sl:0.03,  rr:3.0,  side:'short' },
  't2a_d_hammer_long':          { sl:0.05,  rr:2.5,  side:'long'  },
  't2b_w_sweep_hi_short':       { sl:0.08,  rr:2.5,  side:'short' },
  't2d_d_squeeze_brk_long':     { sl:0.03,  rr:2.67, side:'long'  },
  't2e_w_mo_reclaim_long':      { sl:0.07,  rr:2.57, side:'long'  },
  't2f_h4_rsi_bear_div_short':  { sl:0.025, rr:2.4,  side:'short' },
  't2g_d_bull_flag_long':       { sl:0.03,  rr:3.0,  side:'long'  },
  't3b_h4_sweep_hi_short_loose':{ sl:0.015, rr:2.5,  side:'short' },
  't3c_w_5bar_low_long':        { sl:0.05,  rr:2.0,  side:'long'  },
};

function estimateSlTp(t) {
  const ep = parseFloat(t.entry_price) || 0;
  if (!ep) return { sl: null, tp: null, estimated: false };
  // Use actual values if present
  const slActual = t.sl_price != null && t.sl_price !== '' && !isNaN(+t.sl_price) ? +t.sl_price : null;
  const tpActual = t.tp_price != null && t.tp_price !== '' && !isNaN(+t.tp_price) ? +t.tp_price : null;
  if (slActual !== null && tpActual !== null) return { sl: slActual, tp: tpActual, estimated: false };

  const key = (t.setup_type || t.strat_id || '').toLowerCase();
  const cfg = _STRAT_CFG[key];
  if (!cfg) return { sl: slActual, tp: tpActual, estimated: false };

  // Use sl_distance_pct from CSV if available, else fall back to config sl
  const slPct = t.sl_distance_pct != null && !isNaN(parseFloat(t.sl_distance_pct))
    ? Math.abs(parseFloat(t.sl_distance_pct)) / 100
    : cfg.sl;
  const rrTarget = t.rr_target != null && !isNaN(parseFloat(t.rr_target))
    ? parseFloat(t.rr_target) : cfg.rr;

  const slEst = cfg.side === 'long' ? ep * (1 - slPct) : ep * (1 + slPct);
  const tpEst = cfg.side === 'long' ? ep * (1 + slPct * rrTarget) : ep * (1 - slPct * rrTarget);

  return {
    sl: slActual !== null ? slActual : +slEst.toFixed(2),
    tp: tpActual !== null ? tpActual : +tpEst.toFixed(2),
    estimated: slActual === null || tpActual === null,
  };
}

function shortStratName(setupType) {
  const full = (window.STRAT_NAMES || {})[setupType?.toLowerCase()] || '';
  if (full) {
    const words = full.split(/\s+/);
    const tf = words[0]; // "4H", "1H", "Daily", etc.
    const abbr = words.slice(1).filter(w => /[A-Za-z]/.test(w)).map(w => w[0].toUpperCase()).join('');
    return (tf + '·' + abbr).slice(0, 8);
  }
  // Fallback: parse raw strat name for timeframe
  const m = (setupType || '').match(/_(h1|h4|d|w)_/i);
  const tf = m ? m[1].toUpperCase() : '';
  return (tf || setupType || '?').slice(0, 8);
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

// ── Journal Chart (ECharts) ────────────────────────────────────────────────────
function JournalChart({ trades, selectedId, onSelectTrade }) {
  const containerRef = React.useRef(null);
  const chartRef     = React.useRef(null);
  const tradeMapRef  = React.useRef([]);
  const [candles, setCandles]     = React.useState([]);
  const [livePrice, setLivePrice] = React.useState(null);
  const [loading, setLoading]     = React.useState(true);

  // Fetch 4H candles + live price
  React.useEffect(() => {
    setLoading(true);
    const tryFetch = url =>
      fetch(url).then(r => { if (!r.ok) throw 0; return r.json(); });

    tryFetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=300')
      .catch(() => tryFetch('https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=300'))
      .then(arr => {
        if (!Array.isArray(arr)) throw 0;
        setCandles(arr.map(k => ({
          t: k[0],
          o: parseFloat(k[1]), h: parseFloat(k[2]),
          l: parseFloat(k[3]), c: parseFloat(k[4]),
        })));
        setLoading(false);
      }).catch(() => setLoading(false));

    const fetchPrice = () =>
      fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
        .then(r => r.json()).then(t => { if (t?.price) setLivePrice(parseFloat(t.price)); }).catch(() => {});
    fetchPrice();
    const id = setInterval(fetchPrice, 15000);
    return () => clearInterval(id);
  }, []);

  // Build / update ECharts option
  React.useEffect(() => {
    if (!containerRef.current || candles.length < 2 || typeof echarts === 'undefined') return;

    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current, null, { renderer: 'canvas' });
      chartRef.current.on('click', params => {
        if (params.dataType === 'markArea') {
          onSelectTrade(tradeMapRef.current[params.dataIndex]?.trade_id ?? null);
        } else {
          onSelectTrade(null);
        }
      });
    }

    const chart = chartRef.current;
    const now   = Date.now();

    // Snap a timestamp to the nearest candle index (for category axis)
    const snapIdx = ts => {
      let best = 0, bestD = Infinity;
      candles.forEach((c, i) => { const d = Math.abs(c.t - ts); if (d < bestD) { bestD = d; best = i; } });
      return best;
    };

    // Build markArea data paired to trades
    const validTrades = trades.filter(t => t.timestamp_entry && t.entry_price);
    tradeMapRef.current = validTrades;
    const selectedTrade = validTrades.find(tr => tr.trade_id === selectedId) || null;

    const markAreaData = validTrades.map(t => {
      const entryTs = new Date(t.timestamp_entry).getTime();
      const exitTs  = t.timestamp_exit ? new Date(t.timestamp_exit).getTime() : now;
      const entryP  = +t.entry_price;
      const exitP   = t.exit_price ? +t.exit_price : (livePrice || entryP);
      const open     = !t.exit_price;
      const isSelected = selectedId === t.trade_id;
      const arrow    = t.direction === 'long' ? '▲' : '▼';

      const fillColor   = open                         ? 'rgba(247,147,26,0.15)'
                        : t.exit_reason === 'tp_hit'   ? 'rgba(0,208,132,0.15)'
                        :                                'rgba(255,77,109,0.15)';
      const borderColor = isSelected                   ? '#ffffff'
                        : open                         ? '#F7931A'
                        : t.exit_reason === 'tp_hit'   ? '#00d084'
                        :                                '#ff4d6d';

      return [
        {
          xAxis: snapIdx(entryTs),
          yAxis: Math.min(entryP, exitP),
          itemStyle: { color: fillColor, borderColor, borderWidth: isSelected ? 2 : 1 },
          label: {
            show: true,
            position: 'insideTopLeft',
            // Show arrow always; append short name only for the selected trade
            formatter: isSelected ? arrow + ' ' + shortStratName(t.setup_type) : arrow,
            fontSize: isSelected ? 10 : 12,
            color: borderColor,
            fontFamily: 'JetBrains Mono, monospace',
          },
        },
        { xAxis: snapIdx(exitTs), yAxis: Math.max(entryP, exitP) },
      ];
    });

    // SL/TP zone rectangles for the selected trade only
    if (selectedTrade) {
      const _selSlTp = estimateSlTp(selectedTrade);
      const selEntryTs = new Date(selectedTrade.timestamp_entry).getTime();
      const selExitTs  = selectedTrade.timestamp_exit ? new Date(selectedTrade.timestamp_exit).getTime() : now;
      const selEp = +selectedTrade.entry_price;
      const x1 = snapIdx(selEntryTs), x2 = snapIdx(selExitTs);
      const selTp = _selSlTp.tp;
      const selSl = _selSlTp.sl;
      if (selTp) markAreaData.push([
        { xAxis: x1, yAxis: Math.min(selEp, selTp),
          itemStyle: { color: 'rgba(0,208,132,0.08)', borderColor: 'rgba(0,208,132,0.4)', borderWidth: 1 },
          label: { show: false } },
        { xAxis: x2, yAxis: Math.max(selEp, selTp) },
      ]);
      if (selSl) markAreaData.push([
        { xAxis: x1, yAxis: Math.min(selEp, selSl),
          itemStyle: { color: 'rgba(255,77,109,0.08)', borderColor: 'rgba(255,77,109,0.4)', borderWidth: 1 },
          label: { show: false } },
        { xAxis: x2, yAxis: Math.max(selEp, selSl) },
      ]);
    }

    // Show last ~80 candles by default (current time window)
    const zoomStart = Math.max(0, Math.round((1 - 80 / candles.length) * 100));

    const currentPrice = livePrice || candles[candles.length - 1].c;

    chart.setOption({
      backgroundColor: '#0d0d11',
      animation: false,
      grid: { top: 16, right: 80, bottom: 36, left: 10 },
      xAxis: {
        type: 'category',
        data: candles.map(c => c.t),
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#1f1f28' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#3e3e52', fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          formatter: v => { const d = new Date(+v); return `${d.getMonth()+1}/${d.getDate()}`; },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        position: 'right',
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#3e3e52', fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          formatter: v => '$' + Math.round(v).toLocaleString('en-US'),
        },
        splitLine: { lineStyle: { color: '#1a1a22' } },
      },
      dataZoom: [{ type: 'inside', start: zoomStart, end: 100 }],
      series: [{
        type: 'candlestick',
        data: candles.map(c => [c.o, c.c, c.l, c.h]),
        itemStyle: {
          color: 'rgba(0,208,132,0.8)', color0: 'rgba(255,77,109,0.8)',
          borderColor: '#00d084', borderColor0: '#ff4d6d', borderWidth: 1,
        },
        markArea: markAreaData.length ? {
          silent: false,
          emphasis: { disabled: true },
          data: markAreaData,
        } : undefined,
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: currentPrice }],
          lineStyle: { color: '#F7931A', type: 'dashed', width: 1 },
          label: {
            show: true, position: 'end',
            formatter: '$' + Math.round(currentPrice).toLocaleString('en-US'),
            color: '#0d0d11', backgroundColor: '#F7931A',
            padding: [3, 6], borderRadius: 3,
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 'bold',
          },
        },
      }],
      tooltip: { show: false },
    }, { notMerge: true });

  }, [candles, trades, selectedId, livePrice]);

  // Resize when container size changes (also fires when tab becomes visible)
  React.useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(() => { if (chartRef.current) chartRef.current.resize(); });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => { if (chartRef.current) { chartRef.current.dispose(); chartRef.current = null; } };
  }, []);

  return (
    <div style={{ background: '#0d0d11', border: '1px solid #1f1f28', borderRadius: 10,
                  overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding:'10px 14px 6px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:11, color:'#3e3e52', fontFamily:"'JetBrains Mono',monospace" }}>BTC / USD  4H</span>
        <div style={{ display:'flex', gap:16, fontSize:10, color:'#3e3e52' }}>
          <span><span style={{color:'#00d084'}}>■</span> TP hit</span>
          <span><span style={{color:'#ff4d6d'}}>■</span> SL hit</span>
          <span><span style={{color:'#F7931A'}}>■</span> Open / Trail</span>
          <span style={{color:'#5a5a6e'}}>Scroll to zoom · Click box to select</span>
        </div>
      </div>
      {loading && (
        <div style={{ height:320, display:'flex', alignItems:'center', justifyContent:'center',
                      color:'#3e3e52', fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>
          Loading candles…
        </div>
      )}
      <div ref={containerRef} style={{ width:'100%', height: loading ? 0 : 320 }} />
    </div>
  );
}

// ── Coinbase Balance Strip ─────────────────────────────────────────────────────
function CoinbaseStrip() {
  const [cb, setCb] = React.useState(null);
  React.useEffect(() => {
    const load = () => fetch('/api/coinbase')
      .then(r => r.ok ? r.json() : null).then(d => { if (d && !d.err) setCb(d); }).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (!cb || !cb.configured) return null;
  const mono = { fontFamily:"'JetBrains Mono',monospace" };
  return (
    <div style={{ display:'flex', gap:10, marginBottom:18, flexWrap:'wrap' }}>
      {[
        { label:'Cash Balance', val: cb.total_usd != null ? `$${cb.total_usd.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—', color:'#F7931A' },
        { label:'BTC',  val: cb.btc  != null ? `${cb.btc.toFixed(6)} BTC` : '—',  color:'#ece9e2' },
        { label:'Cash', val: cb.usd  != null ? `$${cb.usd.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—', color:'#ece9e2' },
        { label:'BTC Price', val: cb.btc_price ? `$${cb.btc_price.toLocaleString('en-US')}` : '—', color:'#5a5a6e' },
      ].map(({ label, val, color }) => (
        <div key={label} style={{ background:'#111116', border:'1px solid #1f1f28', borderRadius:8,
                                   padding:'10px 16px', flex:'1 1 160px' }}>
          <div style={{ fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:4 }}>{label}</div>
          <div style={{ fontSize:16, fontWeight:700, color, ...mono }}>{val}</div>
        </div>
      ))}
      <div style={{ background:'rgba(0,208,132,0.06)', border:'1px solid rgba(0,208,132,0.15)',
                    borderRadius:8, padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ width:7, height:7, borderRadius:'50%', background:'#00d084',
                       boxShadow:'0 0 6px #00d084', display:'inline-block' }}></span>
        <span style={{ fontSize:11, color:'#00d084', fontWeight:600 }}>Coinbase Live</span>
      </div>
    </div>
  );
}

// ── Trading Mode Card ──────────────────────────────────────────────────────────
function TradingModeCard() {
  const [mode, setMode]         = React.useState('paper');
  const [changedAt, setChangedAt] = React.useState(null);
  const [step, setStep]         = React.useState('idle'); // idle | confirm-live | confirm-paper
  const [saving, setSaving]     = React.useState(false);
  const [msg, setMsg]           = React.useState(null);
  const [confirmText, setConfirmText] = React.useState('');

  React.useEffect(() => {
    fetch('/api/trading_mode').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setMode(d.mode || 'paper'); setChangedAt(d.changed_at); }
    }).catch(() => {});
  }, []);

  const applyMode = (newMode) => {
    setSaving(true); setMsg(null); setConfirmText('');
    fetch('/api/trading_mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    }).then(r => r.json()).then(d => {
      if (d.ok) {
        setMode(newMode);
        setChangedAt(new Date().toUTCString().slice(0, 25));
        setMsg(newMode === 'live' ? '✓ Live trading enabled. Bot will place real orders.' : '✓ Switched to paper trading. No real orders will be placed.');
      } else {
        setMsg('Error: ' + (d.err || 'unknown'));
      }
      setStep('idle'); setSaving(false);
    }).catch(e => { setMsg('Error: ' + e.message); setSaving(false); });
  };

  const isLive = mode === 'live';

  return (
    <div style={{ background: isLive ? 'rgba(0,208,132,0.04)' : 'rgba(247,147,26,0.04)',
                  border: `1px solid ${isLive ? 'rgba(0,208,132,0.2)' : 'rgba(247,147,26,0.2)'}`,
                  borderRadius:10, padding:'20px 22px', marginBottom:18 }}>

      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:11, color:'#3e3e52', letterSpacing:'1px', textTransform:'uppercase', marginBottom:4 }}>Trading Mode</div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:10, height:10, borderRadius:'50%', display:'inline-block',
                           background: isLive ? '#00d084' : '#F7931A',
                           boxShadow: `0 0 8px ${isLive ? '#00d084' : '#F7931A'}` }}></span>
            <span style={{ fontSize:20, fontWeight:700, color: isLive ? '#00d084' : '#F7931A',
                           fontFamily:"'JetBrains Mono',monospace", letterSpacing:'1px' }}>
              {isLive ? 'LIVE TRADING' : 'PAPER TRADING'}
            </span>
          </div>
          {changedAt && <div style={{ fontSize:10, color:'#3e3e52', marginTop:4 }}>Last changed: {changedAt}</div>}
        </div>

        {/* Mode pills */}
        <div style={{ display:'flex', gap:6, background:'#0d0d11', padding:4, borderRadius:8, border:'1px solid #1f1f28' }}>
          <div style={{ padding:'6px 16px', borderRadius:6, fontSize:12, fontWeight:600,
                        background: !isLive ? 'rgba(247,147,26,0.15)' : 'transparent',
                        color: !isLive ? '#F7931A' : '#3e3e52' }}>Paper</div>
          <div style={{ padding:'6px 16px', borderRadius:6, fontSize:12, fontWeight:600,
                        background: isLive ? 'rgba(0,208,132,0.15)' : 'transparent',
                        color: isLive ? '#00d084' : '#3e3e52' }}>Live</div>
        </div>
      </div>

      {/* Description */}
      <div style={{ fontSize:12, color:'#5a5a6e', lineHeight:1.7, marginBottom:16,
                    padding:'10px 14px', background:'#0d0d11', borderRadius:7, border:'1px solid #1a1a22' }}>
        {isLive
          ? '⚡ Bot is placing REAL orders on Coinbase with your actual funds. All signals trigger live trades.'
          : '🔬 Paper mode — bot scans and signals normally but does NOT place any real orders on Coinbase. Safe for testing.'}
      </div>

      {/* Action area */}
      {step === 'idle' && (
        <div style={{ display:'flex', gap:8 }}>
          {!isLive ? (
            <button onClick={() => setStep('confirm-live')}
              style={{ padding:'10px 24px', borderRadius:7, border:'1px solid rgba(0,208,132,0.3)',
                       background:'rgba(0,208,132,0.1)', color:'#00d084', fontSize:13, fontWeight:700,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>
              Enable Live Trading →
            </button>
          ) : (
            <button onClick={() => setStep('confirm-paper')}
              style={{ padding:'10px 24px', borderRadius:7, border:'1px solid #1f1f28',
                       background:'rgba(90,90,110,0.1)', color:'#5a5a6e', fontSize:13, fontWeight:600,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>
              Switch to Paper
            </button>
          )}
        </div>
      )}

      {/* Step 1 → confirm going LIVE (text input + 2-button confirmation) */}
      {step === 'confirm-live' && (
        <div style={{ background:'rgba(255,77,109,0.06)', border:'1px solid rgba(255,77,109,0.25)',
                      borderRadius:8, padding:'16px 18px' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#ff4d6d', marginBottom:6 }}>
            ⚠ You are about to enable LIVE trading
          </div>
          <div style={{ fontSize:12, color:'#ece9e2', lineHeight:1.7, marginBottom:14 }}>
            The bot will place <b>real orders</b> on Coinbase using your actual funds.
            Make sure your risk settings are correct before proceeding.
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:'#5a5a6e', marginBottom:6 }}>
              Type <span style={{ color:'#ff4d6d', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>LIVE</span> to unlock:
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="Type LIVE"
              autoFocus
              style={{ width:'100%', padding:'9px 12px', borderRadius:6, outline:'none',
                       border:`1px solid ${confirmText === 'LIVE' ? 'rgba(0,208,132,0.5)' : '#2a2a38'}`,
                       background:'#0d0d11', color: confirmText === 'LIVE' ? '#00d084' : '#ece9e2',
                       fontSize:13, fontFamily:"'JetBrains Mono',monospace", transition:'border-color 0.2s, color 0.2s' }}
            />
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => { setStep('idle'); setConfirmText(''); }}
              style={{ flex:1, padding:'10px 0', borderRadius:7, border:'1px solid #1f1f28',
                       background:'#0d0d11', color:'#5a5a6e', fontSize:12, fontWeight:600,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>
              ← Cancel
            </button>
            <button onClick={() => applyMode('live')} disabled={saving || confirmText !== 'LIVE'}
              style={{ flex:2, padding:'10px 0', borderRadius:7, border:'1px solid rgba(255,77,109,0.4)',
                       background:'rgba(255,77,109,0.15)', color:'#ff4d6d', fontSize:13, fontWeight:700,
                       cursor: (saving || confirmText !== 'LIVE') ? 'not-allowed' : 'pointer',
                       fontFamily:"'Space Grotesk',sans-serif",
                       opacity: (saving || confirmText !== 'LIVE') ? 0.4 : 1, transition:'opacity 0.2s' }}>
              {saving ? 'Enabling…' : '✓ Confirm — Enable Live Trading'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm switching back to paper */}
      {step === 'confirm-paper' && (
        <div style={{ background:'rgba(247,147,26,0.06)', border:'1px solid rgba(247,147,26,0.25)',
                      borderRadius:8, padding:'16px 18px' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#F7931A', marginBottom:6 }}>
            Switch to Paper Trading?
          </div>
          <div style={{ fontSize:12, color:'#ece9e2', lineHeight:1.7, marginBottom:14 }}>
            The bot will stop placing real orders. Any currently open position will remain open — you must close it manually on Coinbase.
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setStep('idle')}
              style={{ flex:1, padding:'10px 0', borderRadius:7, border:'1px solid #1f1f28',
                       background:'#0d0d11', color:'#5a5a6e', fontSize:12, fontWeight:600,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>
              ← Cancel
            </button>
            <button onClick={() => applyMode('paper')} disabled={saving}
              style={{ flex:2, padding:'10px 0', borderRadius:7, border:'1px solid rgba(247,147,26,0.3)',
                       background:'rgba(247,147,26,0.12)', color:'#F7931A', fontSize:13, fontWeight:700,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif",
                       opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Switching…' : '✓ Confirm — Switch to Paper'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ marginTop:10, fontSize:12, color: msg.startsWith('✓') ? '#00d084' : '#ff4d6d',
                      fontFamily:"'JetBrains Mono',monospace" }}>
          {msg}
        </div>
      )}
    </div>
  );
}

// ── Journal ───────────────────────────────────────────────────────────────────
function Journal({ data, viewMode, setViewMode, dateRange, strategyFilter, clearStrategyFilter }) {
  const [expanded, setExpanded]   = React.useState(null);
  const [filter, setFilter]       = React.useState('all');
  const [selectedId, setSelectedId] = React.useState(null);

  const trades = (data.trades || []).filter(t => {
    // Strategy filter from Overview card click
    if (strategyFilter && t.setup_type?.toLowerCase() !== strategyFilter.toLowerCase()) return false;
    return (
      filter === 'all'    ? true :
      filter === 'open'   ? t.open :
      filter === 'closed' ? !t.open :
      filter === 'long'   ? t.direction === 'long' :
      filter === 'short'  ? t.direction === 'short' :
      filter === 'tier1'  ? +t.tier === 1 :
      filter === 'tier2'  ? +t.tier === 2 :
      filter === 'tier3'  ? +t.tier === 3 :
      filter === 'a+'     ? t.grade === 'A+' :
      filter === 'solid'  ? t.grade === 'Solid' :
      filter === 'b'      ? t.grade === 'B' :
      true
    );
  });

  // Clear strategy filter when switching to backtest (strategy names differ)
  React.useEffect(() => {
    if (viewMode === 'backtest' && strategyFilter) clearStrategyFilter();
  }, [viewMode]);

  // When a trade is selected via chart click, expand it in the table
  React.useEffect(() => {
    if (selectedId) setExpanded(selectedId);
  }, [selectedId]);

  const exitColor = r =>
    r === 'tp_hit' ? '#00d084' : r === 'sl_hit' ? '#ff4d6d' :
    r === 'trail_stop' ? '#F7931A' : '#5a5a6e';

  return (
    <div style={jStyles.wrap}>
      <div style={jStyles.header}>
        <div>
          <div style={jStyles.pageTitle}>Trade Journal</div>
          {viewMode === 'backtest' && dateRange &&
            <div style={{fontSize:12, color:'#38bdf8', marginTop:4}}>
              Backtest · {dateRange.start?.slice(0,4)}→{dateRange.end?.slice(0,4)} · {(data.trades||[]).length} trades
            </div>}
          {viewMode === 'paper' &&
            <div style={{fontSize:12, color:'#F7931A', marginTop:4}}>Paper trading · DRY trades only</div>}
        </div>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          {viewMode !== undefined && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} dateRange={dateRange} />}
        </div>
      </div>
      <div style={{...jStyles.header, marginTop:0, marginBottom:16}}>
        <div style={jStyles.filters}>
          {[
            ['all','All'], ['open','Open'], ['closed','Closed'],
            ['long','Longs'], ['short','Shorts'],
            ['tier1','T1'], ['tier2','T2'], ['tier3','T3'],
            ['a+','A+'], ['solid','Solid'], ['b','B'],
          ].map(([f, lbl]) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{...jStyles.filterBtn, ...(filter===f ? jStyles.filterActive : {})}}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Strategy filter banner */}
      {strategyFilter && (
        <div style={{background:'rgba(247,147,26,0.07)', border:'1px solid rgba(247,147,26,0.2)',
          borderRadius:8, padding:'8px 14px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <span style={{fontSize:12, color:'#F7931A', fontFamily:"'JetBrains Mono',monospace"}}>
            Filtering: {strategyFilter}
          </span>
          <button onClick={clearStrategyFilter}
            style={{background:'none', border:'none', color:'#F7931A', cursor:'pointer', fontSize:12, fontFamily:"'Space Grotesk',sans-serif"}}>
            ✕ Clear filter
          </button>
        </div>
      )}

      {/* Coinbase live balance */}
      <CoinbaseStrip />

      {/* Trading mode toggle */}
      <TradingModeCard />

      {/* Chart */}
      <JournalChart
        trades={trades}
        selectedId={selectedId}
        onSelectTrade={id => {
          setSelectedId(id);
          if (id) setExpanded(id);
        }}
      />

      {/* Debug counter */}
      <div style={{fontSize:10, color:'#2a2a38', fontFamily:"'JetBrains Mono',monospace", marginBottom:8, textAlign:'right'}}>
        API returned {(data.trades||[]).length} trades · showing {trades.length} (filter: {filter})
      </div>

      {/* Table */}
      <div style={jStyles.tableWrap}>
        <table style={jStyles.table}>
          <thead>
            <tr>
              {['ID','Dir','Setup','Tier','Grade','Entry','Exit','Exit Reason','Bars','R Mult','Net PnL','Fees',''].map(h => (
                <th key={h} style={jStyles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr>
                <td colSpan={13} style={{padding:'56px 24px', textAlign:'center'}}>
                  <div style={{fontSize:24, opacity:0.07, marginBottom:12}}>✦</div>
                  <div style={{fontSize:14, color:'#3e3e52', marginBottom:6}}>
                    {data.trades.length === 0 ? 'No trades recorded yet' : `No ${filter} trades`}
                  </div>
                  <div style={{fontSize:12, color:'#2a2a38', marginBottom: strategyFilter ? 12 : 0}}>
                    {data.trades.length === 0
                      ? 'Your first trade will appear here automatically once the bot closes a position.'
                      : 'Try a different filter to see other trades.'}
                  </div>
                  {strategyFilter && data.trades.length > 0 && (
                    <button onClick={clearStrategyFilter}
                      style={{padding:'6px 16px', borderRadius:6, border:'1px solid rgba(247,147,26,0.3)',
                        background:'rgba(247,147,26,0.1)', color:'#F7931A', cursor:'pointer',
                        fontSize:12, fontFamily:"'Space Grotesk',sans-serif"}}>
                      ✕ Clear strategy filter ({strategyFilter})
                    </button>
                  )}
                </td>
              </tr>
            )}
            {trades.map(t => (
              <React.Fragment key={t.trade_id}>
                <tr
                  style={{
                    ...jStyles.tr,
                    ...(t.open ? {background:'rgba(247,147,26,0.03)'} : {}),
                    ...(selectedId === t.trade_id ? {background:'rgba(247,147,26,0.08)', outline:'1px solid rgba(247,147,26,0.2)'} : {}),
                  }}
                  onClick={() => {
                    const next = expanded === t.trade_id ? null : t.trade_id;
                    setExpanded(next);
                    setSelectedId(next);
                  }}>
                  <td style={{...jStyles.monoTd, fontSize:10, color:'#3e3e52'}}>{t.trade_id}</td>
                  <td style={jStyles.td}>
                    <span style={{...jStyles.badge, ...(t.direction==='long'?jStyles.long:jStyles.short)}}>{t.direction.toUpperCase()}</span>
                  </td>
                  <td style={jStyles.td}>
                    <span style={{fontSize:12, color:'#F7931A', fontWeight:600}} title={t.setup_type}>
                      {(window.STRAT_NAMES||{})[t.setup_type?.toLowerCase()] || t.setup_type}
                    </span>
                    {t.open && <span style={jStyles.openPill}>OPEN</span>}
                  </td>
                  <td style={jStyles.td}><TierBadge tier={t.tier} /></td>
                  <td style={jStyles.td}><GradeBadge grade={t.grade} /></td>
                  <td style={jStyles.monoTd}>${(+t.entry_price).toLocaleString('en-US')}</td>
                  <td style={jStyles.monoTd}>{t.exit_price ? `$${(+t.exit_price).toLocaleString('en-US')}` : '—'}</td>
                  <td style={jStyles.td}>
                    {t.exit_reason
                      ? <span style={{fontSize:11, color: exitColor(t.exit_reason), fontFamily:"'JetBrains Mono',monospace"}}>{t.exit_reason}</span>
                      : <span style={{color:'#2a2a38', fontSize:11}}>—</span>}
                  </td>
                  <td style={{...jStyles.monoTd, color:'#5a5a6e'}}>{t.bars_held ?? '—'}</td>
                  <td style={{...jStyles.monoTd, fontWeight:700, color: t.r_multiple == null ? '#5a5a6e' : t.r_multiple >= 0 ? '#00d084':'#ff4d6d'}}>
                    {t.r_multiple == null ? '—' : `${t.r_multiple >= 0 ? '+':''}${parseFloat(t.r_multiple).toFixed(2)}R`}
                  </td>
                  <td style={{...jStyles.monoTd, color: t.pnl_net_usd == null ? '#5a5a6e' : t.pnl_net_usd >= 0 ? '#00d084':'#ff4d6d'}}>
                    {t.pnl_net_usd == null ? '—' : `${t.pnl_net_usd >= 0 ? '+' : '-'}$${Math.abs(parseFloat(t.pnl_net_usd)).toFixed(2)}`}
                  </td>
                  <td style={{...jStyles.monoTd, color:'#5a5a6e'}}>{t.fees_usd ? `$${parseFloat(t.fees_usd).toFixed(2)}` : '—'}</td>
                  <td style={{...jStyles.td, color:'#3e3e52', cursor:'pointer', fontSize:16, paddingRight:14}}>{expanded===t.trade_id?'−':'+'}</td>
                </tr>

                {expanded === t.trade_id && (() => {
                  const SN = window.STRAT_NAMES || {};
                  const setupName = SN[(t.primary_setup||'').toLowerCase()] || SN[(t.setup_type||'').toLowerCase()] || t.primary_setup || t.setup_type || '—';
                  const entrySlice = t.timestamp_entry?.slice(0,16);
                  const exitSlice  = t.timestamp_exit?.slice(0,16);
                  const exitMissing = !t.timestamp_exit || exitSlice === entrySlice;
                  const exitDisplay = exitMissing ? null : `${exitSlice.replace('T',' ')} UTC`;
                  const slTp = estimateSlTp(t);
                  const slOk = slTp.sl != null;
                  const tpOk = slTp.tp != null;
                  const slTpEst = slTp.estimated;
                  const hasVenue = t.venue || t.venue_adapter || t.source;
                  const hasInd = [t.atr,t.atr_avg50,t.ema_fast,t.ema_slow,t.vol_ratio,t.hi50,t.lo50].some(v => v != null && v !== '' && !isNaN(parseFloat(v)));
                  // Fee estimation: use balance_after – pnl as equity before
                  const eqBefore = t.balance_after != null && t.pnl_net_usd != null
                    ? t.balance_after - t.pnl_net_usd : undefined;
                  const feeInfo = estimateFee(t, eqBefore);
                  return (
                  <tr style={{background:'#0d0d11'}}>
                    <td colSpan={13} style={{padding:'16px 20px'}}>
                      <div style={jStyles.expandGrid}>

                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>Trade Details</div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>trade_id</span><span style={jStyles.xval}>{t.trade_id}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Setup</span><span style={{...jStyles.xval,color:'#F7931A'}}>{setupName}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Entry time</span><span style={jStyles.xval}>{entrySlice?.replace('T',' ')} UTC</span></div>
                          <div style={jStyles.xrow}>
                            <span style={jStyles.xlbl}>Exit time</span>
                            {exitDisplay
                              ? <span style={jStyles.xval}>{exitDisplay}</span>
                              : <span style={{...jStyles.xval, color:'#3e3e52', fontStyle:'italic'}}>Not recorded</span>}
                          </div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>SL / TP</span><span style={{...jStyles.xval, color: slTpEst ? '#5a5a6e' : undefined}}>
                            {slOk || tpOk
                              ? <>{slTpEst ? '~' : ''}{slOk ? `$${slTp.sl.toLocaleString('en-US')}` : '—'} / {slTpEst ? '~' : ''}{tpOk ? `$${slTp.tp.toLocaleString('en-US')}` : '—'}</>
                              : '—'}
                          </span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>RR target</span><span style={jStyles.xval}>1 : {t.rr_target ?? '—'}</span></div>
                          {t.max_risk_usd != null && t.max_risk_usd !== '' && (
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>max_risk_usd</span><span style={jStyles.xval}>${t.max_risk_usd}</span></div>)}
                          {t.nano_qty != null && t.nano_qty !== '' && (
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>nano_qty</span><span style={jStyles.xval}>{t.nano_qty}</span></div>)}
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Est. fees</span><span style={{...jStyles.xval, color:'#5a5a6e'}}>
                            {feeInfo ? `${feeInfo.estimated ? '~' : ''}$${feeInfo.fee.toFixed(2)}` : '—'}
                          </span></div>
                          {t.grade != null && t.grade !== '' && (
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Grade</span><span style={jStyles.xval}><GradeBadge grade={t.grade} /></span></div>)}
                          {(t.alt_scale_applied != null || t.atr_scale_applied != null) && (
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>scale_applied</span><span style={{...jStyles.xval,color:(t.alt_scale_applied||t.atr_scale_applied)?'#00d084':'#5a5a6e'}}>{String(t.alt_scale_applied ?? t.atr_scale_applied)}</span></div>)}
                        </div>

                        {hasInd && (
                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>Indicators at Entry</div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>ATR(14)</span><span style={jStyles.xval}>{t.atr != null ? `$${(+t.atr).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>ATR avg50</span><span style={jStyles.xval}>{t.atr_avg50 != null ? `$${(+t.atr_avg50).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>EMA(21)</span><span style={jStyles.xval}>{t.ema_fast != null ? `$${(+t.ema_fast).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>EMA(50)</span><span style={jStyles.xval}>{t.ema_slow != null ? `$${(+t.ema_slow).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Vol ratio</span><span style={{...jStyles.xval, color:(+t.vol_ratio)>=1.5?'#F7931A':'#ece9e2'}}>{t.vol_ratio != null ? `${parseFloat(t.vol_ratio).toFixed(2)}×` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>hi50 / lo50</span><span style={jStyles.xval}>{t.hi50 != null ? `$${(+t.hi50).toLocaleString('en-US')}` : '—'} / {t.lo50 != null ? `$${(+t.lo50).toLocaleString('en-US')}` : '—'}</span></div>
                        </div>
                        )}

                        {(t.daily_trend || t.weekly_trend || t.ema_gap_daily != null ||
                          t.ema_gap_weekly != null || (t.sig_body_ratio != null && t.sig_body_ratio !== '') ||
                          t.sig_dist_ema50 != null || (t.d_rsi != null && t.d_rsi !== '') ||
                          (t.w_rsi != null && t.w_rsi !== '') || t.tp_near_res != null) && (
                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>MTF Alignment</div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Daily trend</span><span style={{...jStyles.xval,color:t.daily_trend==='bull'?'#00d084':'#ff4d6d'}}>{t.daily_trend ?? '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Weekly trend</span><span style={{...jStyles.xval,color:t.weekly_trend==='bull'?'#00d084':'#ff4d6d'}}>{t.weekly_trend ?? '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>EMA gap daily</span><span style={{...jStyles.xval,color:t.ema_gap_daily!=null&&Math.abs(t.ema_gap_daily)>=0.01?'#00d084':'#5a5a6e'}}>{t.ema_gap_daily != null ? `${(t.ema_gap_daily*100).toFixed(1)}%` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>EMA gap weekly</span><span style={{...jStyles.xval,color:t.ema_gap_weekly!=null&&Math.abs(t.ema_gap_weekly)>=0.02?'#00d084':'#5a5a6e'}}>{t.ema_gap_weekly != null ? `${(t.ema_gap_weekly*100).toFixed(1)}%` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>sig_body_ratio</span><span style={jStyles.xval}>{t.sig_body_ratio ?? '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>sig_dist_ema50</span><span style={jStyles.xval}>{t.sig_dist_ema50 != null ? `${(t.sig_dist_ema50*100).toFixed(1)}%` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>d_rsi / w_rsi</span><span style={jStyles.xval}>{t.d_rsi ?? '—'} / {t.w_rsi ?? '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>tp_near_res</span><span style={{...jStyles.xval,color:t.tp_near_res?'#ff4d6d':'#5a5a6e'}}>{t.tp_near_res != null ? String(t.tp_near_res) : '—'}</span></div>
                        </div>
                        )}

                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>Notes</div>
                          {t.notes && <div style={{fontSize:13, color:'#ece9e2', lineHeight:1.7}}>{t.notes}</div>}
                          {t.entry_block_reason && <div style={{marginTop:10, fontSize:12, color:'#ff4d6d'}}>Block reason: {t.entry_block_reason}</div>}
                          {hasVenue && (
                          <div style={{marginTop: t.notes || t.entry_block_reason ? 12 : 0, paddingTop: t.notes || t.entry_block_reason ? 10 : 0, borderTop: t.notes || t.entry_block_reason ? '1px solid #1a1a22' : 'none'}}>
                            {t.venue         && <div style={jStyles.xrow}><span style={jStyles.xlbl}>venue</span><span style={jStyles.xval}>{t.venue}</span></div>}
                            {t.venue_adapter && <div style={jStyles.xrow}><span style={jStyles.xlbl}>venue_adapter</span><span style={jStyles.xval}>{t.venue_adapter}</span></div>}
                            {t.source        && <div style={jStyles.xrow}><span style={jStyles.xlbl}>source</span><span style={jStyles.xval}>{t.source}</span></div>}
                          </div>)}
                          {!t.notes && !t.entry_block_reason && !hasVenue &&
                            <div style={{fontSize:11, color:'#2a2a38', fontStyle:'italic'}}>No notes recorded</div>}
                        </div>

                      </div>
                    </td>
                  </tr>
                  );
                })()}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const jStyles = {
  wrap: { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  header: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  filters: { display:'flex', gap:6, flexWrap:'wrap' },
  filterBtn: { padding:'6px 14px', borderRadius:6, border:'1px solid #1f1f28', background:'transparent', color:'#5a5a6e', fontSize:11, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" },
  filterActive: { background:'rgba(247,147,26,0.1)', color:'#F7931A', border:'1px solid rgba(247,147,26,0.25)' },
  tableWrap: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, overflow:'hidden' },
  table: { width:'100%', borderCollapse:'collapse' },
  th: { textAlign:'left', fontSize:10, color:'#3e3e52', fontWeight:600, padding:'11px 12px', letterSpacing:'0.5px', background:'#0d0d11', borderBottom:'1px solid #1a1a22' },
  tr: { borderBottom:'1px solid #15151d', cursor:'pointer' },
  td: { padding:'10px 12px', fontSize:13, color:'#ece9e2', verticalAlign:'middle' },
  monoTd: { padding:'10px 12px', fontSize:13, color:'#ece9e2', verticalAlign:'middle', fontFamily:"'JetBrains Mono',monospace" },
  badge: { fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:4, letterSpacing:'0.5px' },
  long:  { background:'rgba(0,208,132,0.12)', color:'#00d084' },
  short: { background:'rgba(255,77,109,0.12)', color:'#ff4d6d' },
  openPill: { marginLeft:6, fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3, background:'rgba(247,147,26,0.15)', color:'#F7931A', letterSpacing:'0.5px' },
  expandGrid: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 },
  expandCard: { background:'#111116', border:'1px solid #1f1f28', borderRadius:8, padding:'14px 16px' },
  expandTitle: { fontSize:10, color:'#3e3e52', fontWeight:700, letterSpacing:'0.8px', textTransform:'uppercase', marginBottom:10 },
  xrow: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 },
  xlbl: { fontSize:13, color:'#3e3e52' },
  xval: { fontSize:13, fontWeight:600, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace", textAlign:'right' },
};

Object.assign(window, { Journal });
