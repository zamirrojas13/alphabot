
// ── Journal Chart ─────────────────────────────────────────────────────────────
function JournalChart({ trades, selectedId, onSelectTrade }) {
  const canvasRef = React.useRef(null);
  const [candles, setCandles] = React.useState([]);
  const [livePrice, setLivePrice] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  // Fetch 4H candles from Binance (supports 4h natively)
  React.useEffect(() => {
    setLoading(true);
    const tryFetch = url =>
      fetch(url).then(r => { if (!r.ok) throw 0; return r.json(); });

    const load = () =>
      tryFetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=300')
        .catch(() => tryFetch('https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=300'))
        .then(arr => {
          if (!Array.isArray(arr)) throw 0;
          const mapped = arr.map(k => ({
            t: k[0],
            o: parseFloat(k[1]), h: parseFloat(k[2]),
            l: parseFloat(k[3]), c: parseFloat(k[4]),
          }));
          setCandles(mapped);
          setLoading(false);
        }).catch(() => setLoading(false));

    load();

    const fetchPrice = () =>
      fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
        .then(r => r.json()).then(t => { if (t?.price) setLivePrice(parseFloat(t.price)); }).catch(() => {});
    fetchPrice();
    const id = setInterval(fetchPrice, 15000);
    return () => clearInterval(id);
  }, []);

  // Draw whenever candles, trades, or selection changes
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const PAD = { top: 16, right: 72, bottom: 36, left: 10 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0d11';
    ctx.fillRect(0, 0, W, H);

    const minT = candles[0].t, maxT = candles[candles.length - 1].t;
    const prices = candles.flatMap(c => [c.h, c.l]);
    // Pad price range to include all trade entry/exit prices
    trades.forEach(t => {
      if (t.entry_price) prices.push(+t.entry_price);
      if (t.exit_price)  prices.push(+t.exit_price);
    });
    const minP = Math.min(...prices) * 0.998;
    const maxP = Math.max(...prices) * 1.002;
    const priceRange = maxP - minP;

    const toX = t  => PAD.left + ((t  - minT) / (maxT - minT)) * cW;
    const toY = p  => PAD.top  + cH - ((p - minP) / priceRange) * cH;

    // Grid
    ctx.strokeStyle = '#1a1a22'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (i / 4) * cH;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
      const price = maxP - (i / 4) * priceRange;
      ctx.fillStyle = '#3e3e52'; ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 }), W - PAD.right + 4, y + 3);
    }

    // ── Trade boxes ─────────────────────────────────────────────────────────
    const now = Date.now();
    trades.forEach(t => {
      const entryT  = t.timestamp_entry ? new Date(t.timestamp_entry).getTime() : null;
      const exitT   = t.timestamp_exit  ? new Date(t.timestamp_exit).getTime()  : now;
      const entryP  = +t.entry_price;
      const exitP   = t.exit_price ? +t.exit_price : (livePrice || entryP);

      if (!entryT || !entryP) return;
      if (entryT > maxT || exitT < minT) return; // completely outside visible range

      const x1 = toX(entryT), x2 = Math.max(toX(exitT), x1 + 3);
      const y1 = toY(Math.max(entryP, exitP));
      const y2 = toY(Math.min(entryP, exitP));
      const boxH = Math.max(y2 - y1, 2);

      const isSelected = selectedId && t.trade_id === selectedId;
      const open = !t.exit_price;
      const color = open ? '#F7931A'
                  : t.exit_reason === 'tp_hit'    ? '#00d084'
                  : t.exit_reason === 'sl_hit'    ? '#ff4d6d'
                  : t.exit_reason === 'trail_stop'? '#F7931A'
                  : '#ece9e2';

      // Fill
      ctx.fillStyle = open
        ? 'rgba(247,147,26,0.12)'
        : t.exit_reason === 'tp_hit'
          ? 'rgba(0,208,132,0.15)'
          : 'rgba(255,77,109,0.15)';
      ctx.fillRect(x1, y1, x2 - x1, boxH);

      // Border
      ctx.strokeStyle = isSelected ? '#fff' : color;
      ctx.lineWidth   = isSelected ? 2 : 1;
      ctx.strokeRect(x1, y1, x2 - x1, boxH);

      // Entry dashed line
      const ey = toY(entryP);
      ctx.strokeStyle = 'rgba(247,147,26,0.5)';
      ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x1, ey); ctx.lineTo(x2, ey); ctx.stroke();
      ctx.setLineDash([]);

      // Label
      if (x2 - x1 > 24) {
        ctx.fillStyle = color; ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        const lbl = (t.direction === 'long' ? '▲' : '▼') + ' ' + (t.setup_type || '');
        ctx.fillText(lbl.slice(0, 10), x1 + 3, y1 + 9);
      }
    });

    // ── Candles ─────────────────────────────────────────────────────────────
    const bw = Math.max(2, (cW / candles.length) * 0.7);
    candles.forEach(c => {
      const x   = toX(c.t);
      const isG = c.c >= c.o;
      const col = isG ? '#00d084' : '#ff4d6d';

      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, toY(c.h)); ctx.lineTo(x, toY(c.l)); ctx.stroke();

      const top  = toY(Math.max(c.o, c.c));
      const bot  = toY(Math.min(c.o, c.c));
      const bodyH = Math.max(1, bot - top);
      ctx.fillStyle = isG ? 'rgba(0,208,132,0.8)' : 'rgba(255,77,109,0.8)';
      ctx.fillRect(x - bw / 2, top, bw, bodyH);
    });

    // ── Current price line ───────────────────────────────────────────────────
    const last = livePrice || candles[candles.length - 1].c;
    const py   = toY(last);
    ctx.strokeStyle = '#F7931A'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + cW, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#F7931A';
    ctx.fillRect(W - PAD.right + 2, py - 9, PAD.right - 4, 18);
    ctx.fillStyle = '#0d0d11'; ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('$' + last.toFixed(0), W - PAD.right / 2, py + 3);

    // ── Time axis ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#3e3e52'; ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(pct => {
      const i = Math.floor(pct * (candles.length - 1));
      const d = new Date(candles[i].t);
      const lbl = `${d.getMonth() + 1}/${d.getDate()}`;
      ctx.fillText(lbl, PAD.left + pct * cW, PAD.top + cH + 22);
    });

    // ── Clickable area detection setup (stored on canvas) ───────────────────
    canvas._tradeHitBoxes = trades
      .filter(t => t.timestamp_entry && +t.entry_price >= minP)
      .map(t => {
        const entryT = new Date(t.timestamp_entry).getTime();
        const exitT  = t.timestamp_exit ? new Date(t.timestamp_exit).getTime() : now;
        const x1 = toX(entryT), x2 = Math.max(toX(exitT), x1 + 3);
        const entryP = +t.entry_price, exitP = t.exit_price ? +t.exit_price : (livePrice || entryP);
        const y1 = toY(Math.max(entryP, exitP)), y2 = toY(Math.min(entryP, exitP));
        return { x1, x2, y1, y2: Math.max(y2, y1 + 2), trade: t };
      });

  }, [candles, trades, selectedId, livePrice]);

  // Click handler
  const handleClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas._tradeHitBoxes) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top)  * scaleY;
    for (const b of canvas._tradeHitBoxes) {
      if (mx >= b.x1 && mx <= b.x2 && my >= b.y1 && my <= b.y2) {
        onSelectTrade(b.trade.trade_id);
        return;
      }
    }
    onSelectTrade(null);
  };

  return (
    <div style={{ background: '#0d0d11', border: '1px solid #1f1f28', borderRadius: 10,
                  overflow: 'hidden', position: 'relative', marginBottom: 24 }}>
      {loading && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
                      justifyContent:'center', color:'#3e3e52', fontSize:12 }}>
          Loading candles…
        </div>
      )}
      <div style={{ padding:'10px 14px 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:11, color:'#3e3e52', fontFamily:"'JetBrains Mono',monospace" }}>BTC / USD  4H</span>
        <div style={{ display:'flex', gap:16, fontSize:10, color:'#3e3e52' }}>
          <span><span style={{color:'#00d084'}}>■</span> TP hit</span>
          <span><span style={{color:'#ff4d6d'}}>■</span> SL hit</span>
          <span><span style={{color:'#F7931A'}}>■</span> Open / Trail</span>
          <span style={{color:'#5a5a6e'}}>Click box to select trade</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={1200} height={320}
        onClick={handleClick}
        style={{ width:'100%', height:320, display:'block', cursor:'crosshair' }}
      />
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

  React.useEffect(() => {
    fetch('/api/trading_mode').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setMode(d.mode || 'paper'); setChangedAt(d.changed_at); }
    }).catch(() => {});
  }, []);

  const applyMode = (newMode) => {
    setSaving(true); setMsg(null);
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

      {/* Step 1 → confirm going LIVE (2-button confirmation) */}
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
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setStep('idle')}
              style={{ flex:1, padding:'10px 0', borderRadius:7, border:'1px solid #1f1f28',
                       background:'#0d0d11', color:'#5a5a6e', fontSize:12, fontWeight:600,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>
              ← Cancel
            </button>
            <button onClick={() => applyMode('live')} disabled={saving}
              style={{ flex:2, padding:'10px 0', borderRadius:7, border:'1px solid rgba(255,77,109,0.4)',
                       background:'rgba(255,77,109,0.15)', color:'#ff4d6d', fontSize:13, fontWeight:700,
                       cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif",
                       opacity: saving ? 0.5 : 1 }}>
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
function Journal({ data, viewMode, setViewMode, dateRange }) {
  const [expanded, setExpanded]   = React.useState(null);
  const [filter, setFilter]       = React.useState('all');
  const [selectedId, setSelectedId] = React.useState(null);

  const trades = (data.trades || []).filter(t =>
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
          {viewMode === 'sim' && dateRange &&
            <div style={{fontSize:12, color:'#F7931A', marginTop:4}}>
              Backtest · {dateRange.start?.slice(0,4)}→{dateRange.end?.slice(0,4)} · {(data.trades||[]).length} trades
            </div>}
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
                  <div style={{fontSize:12, color:'#2a2a38'}}>
                    {data.trades.length === 0
                      ? 'Your first trade will appear here automatically once the bot closes a position.'
                      : 'Try a different filter to see other trades.'}
                  </div>
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
                    <span style={{fontSize:12, color:'#F7931A', fontWeight:600}}>{t.setup_type}</span>
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
                    {t.pnl_net_usd == null ? '—' : `${t.pnl_net_usd >= 0 ? '+':''}$${Math.abs(parseFloat(t.pnl_net_usd)).toFixed(2)}`}
                  </td>
                  <td style={{...jStyles.monoTd, color:'#5a5a6e'}}>{t.fees_usd ? `$${parseFloat(t.fees_usd).toFixed(2)}` : '—'}</td>
                  <td style={{...jStyles.td, color:'#3e3e52', cursor:'pointer', fontSize:16, paddingRight:14}}>{expanded===t.trade_id?'−':'+'}</td>
                </tr>

                {expanded === t.trade_id && (
                  <tr style={{background:'#0d0d11'}}>
                    <td colSpan={13} style={{padding:'16px 20px'}}>
                      <div style={jStyles.expandGrid}>

                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>Trade Details</div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>trade_id</span><span style={jStyles.xval}>{t.trade_id}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>primary_setup</span><span style={{...jStyles.xval,color:'#F7931A'}}>{t.primary_setup}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Entry time</span><span style={jStyles.xval}>{t.timestamp_entry?.slice(0,16).replace('T',' ')} UTC</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Exit time</span><span style={jStyles.xval}>{t.timestamp_exit?.slice(0,16).replace('T',' ') ?? '—'} {t.timestamp_exit ? 'UTC':''}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>SL / TP</span><span style={jStyles.xval}>${(+t.sl_price).toLocaleString('en-US')} / ${(+t.tp_price).toLocaleString('en-US')}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>RR target</span><span style={jStyles.xval}>1 : {t.rr_target}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>max_risk_usd</span><span style={jStyles.xval}>${t.max_risk_usd}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>nano_qty</span><span style={jStyles.xval}>{t.nano_qty}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>atr_scale_applied</span><span style={{...jStyles.xval,color:t.atr_scale_applied?'#00d084':'#5a5a6e'}}>{String(t.atr_scale_applied)}</span></div>
                        </div>

                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>Indicators at Entry</div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>ATR(14)</span><span style={jStyles.xval}>{t.atr != null ? `$${(+t.atr).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>ATR avg50</span><span style={jStyles.xval}>{t.atr_avg50 != null ? `$${(+t.atr_avg50).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>EMA(21)</span><span style={jStyles.xval}>{t.ema_fast != null ? `$${(+t.ema_fast).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>EMA(50)</span><span style={jStyles.xval}>{t.ema_slow != null ? `$${(+t.ema_slow).toLocaleString('en-US')}` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>Vol ratio</span><span style={{...jStyles.xval, color:(+t.vol_ratio)>=1.5?'#F7931A':'#ece9e2'}}>{t.vol_ratio != null ? `${parseFloat(t.vol_ratio).toFixed(2)}×` : '—'}</span></div>
                          <div style={jStyles.xrow}><span style={jStyles.xlbl}>hi50 / lo50</span><span style={jStyles.xval}>{t.hi50 != null ? `$${(+t.hi50).toLocaleString('en-US')}` : '—'} / {t.lo50 != null ? `$${(+t.lo50).toLocaleString('en-US')}` : '—'}</span></div>
                        </div>

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

                        <div style={jStyles.expandCard}>
                          <div style={jStyles.expandTitle}>Notes</div>
                          <div style={{fontSize:13, color:'#ece9e2', lineHeight:1.7}}>{t.notes || <span style={{color:'#2a2a36'}}>No notes</span>}</div>
                          {t.entry_block_reason && <div style={{marginTop:10, fontSize:12, color:'#ff4d6d'}}>Block reason: {t.entry_block_reason}</div>}
                          <div style={{marginTop:12, paddingTop:10, borderTop:'1px solid #1a1a22'}}>
                            <div style={jStyles.xrow}><span style={jStyles.xlbl}>venue</span><span style={jStyles.xval}>{t.venue}</span></div>
                            <div style={jStyles.xrow}><span style={jStyles.xlbl}>venue_adapter</span><span style={jStyles.xval}>{t.venue_adapter}</span></div>
                            <div style={jStyles.xrow}><span style={jStyles.xlbl}>source</span><span style={jStyles.xval}>{t.source}</span></div>
                          </div>
                        </div>

                      </div>
                    </td>
                  </tr>
                )}
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
  td: { padding:'10px 12px', fontSize:12, color:'#ece9e2', verticalAlign:'middle' },
  monoTd: { padding:'10px 12px', fontSize:12, color:'#ece9e2', verticalAlign:'middle', fontFamily:"'JetBrains Mono',monospace" },
  badge: { fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:4, letterSpacing:'0.5px' },
  long:  { background:'rgba(0,208,132,0.12)', color:'#00d084' },
  short: { background:'rgba(255,77,109,0.12)', color:'#ff4d6d' },
  openPill: { marginLeft:6, fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3, background:'rgba(247,147,26,0.15)', color:'#F7931A', letterSpacing:'0.5px' },
  expandGrid: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 },
  expandCard: { background:'#111116', border:'1px solid #1f1f28', borderRadius:8, padding:'14px 16px' },
  expandTitle: { fontSize:10, color:'#3e3e52', fontWeight:700, letterSpacing:'0.8px', textTransform:'uppercase', marginBottom:10 },
  xrow: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 },
  xlbl: { fontSize:11, color:'#3e3e52' },
  xval: { fontSize:11, fontWeight:600, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace", textAlign:'right' },
};

Object.assign(window, { Journal });
