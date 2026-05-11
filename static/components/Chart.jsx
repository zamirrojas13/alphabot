
function ChartPage({ data, activePage }) {
  const containerRef   = React.useRef(null);
  const overlayRef     = React.useRef(null);
  const chartRef       = React.useRef(null);
  const candleRef      = React.useRef(null);
  const volRef         = React.useRef(null);
  const priceLineRef   = React.useRef(null);
  const tradesRef      = React.useRef([]);
  const livePriceRef   = React.useRef(null);

  const [tf, setTf]               = React.useState('4H');
  const [livePrice, setLivePrice] = React.useState(null);
  const [status, setStatus]       = React.useState('connecting…');
  const [headerInfo, setHeaderInfo] = React.useState(null);

  const BINANCE    = (iv, n) => `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${n}`;
  const BINANCE_US = (iv, n) => `https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${n}`;
  const INTERVAL   = { '1H': '1h', '4H': '4h', 'D': '1d', 'W': '1w' };

  // ── Draw trade boxes on the overlay canvas ─────────────────────────────────
  const drawBoxes = React.useCallback(() => {
    const canvas = overlayRef.current;
    const chart  = chartRef.current;
    const cs     = candleRef.current;
    if (!canvas || !chart || !cs) return;

    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const trades = tradesRef.current;
    const nowSec = Math.floor(Date.now() / 1000);

    trades.forEach(t => {
      if (!t.timestamp_entry || !t.entry_price) return;

      const entrySec = Math.floor(new Date(t.timestamp_entry).getTime() / 1000);
      const exitSec  = t.timestamp_exit
        ? Math.floor(new Date(t.timestamp_exit).getTime() / 1000)
        : nowSec;

      const entryP = parseFloat(t.entry_price);
      const exitP  = t.exit_price
        ? parseFloat(t.exit_price)
        : (livePriceRef.current || entryP);

      // Convert to pixel coords
      let x1 = chart.timeScale().timeToCoordinate(entrySec);
      let x2 = chart.timeScale().timeToCoordinate(exitSec);

      // If both endpoints are off-screen in the same direction, skip
      if (x1 === null && x2 === null) return;
      x1 = x1 !== null ? x1 : (exitSec > entrySec ? 0 : W);
      x2 = x2 !== null ? x2 : (exitSec > entrySec ? W : 0);

      const hi = Math.max(entryP, exitP);
      const lo = Math.min(entryP, exitP);
      const y1 = cs.priceToCoordinate(hi);
      const y2 = cs.priceToCoordinate(lo);
      if (y1 === null || y2 === null) return;

      const rx1  = Math.max(Math.min(x1, x2), 0);
      const rx2  = Math.min(Math.max(x1, x2), W);
      const boxW = Math.max(rx2 - rx1, 2);
      const boxH = Math.max(y2 - y1, 2);
      if (boxW < 1) return;

      const isOpen = !t.exit_price;
      const isWin  = t.exit_reason === 'tp_hit' || t.exit_reason === 'trail_stop';
      const color  = isOpen ? '#F7931A' : isWin ? '#00d084' : '#ff4d6d';
      const fillRgba = isOpen
        ? 'rgba(247,147,26,0.13)'
        : isWin ? 'rgba(0,208,132,0.14)' : 'rgba(255,77,109,0.14)';

      // Fill
      ctx.fillStyle = fillRgba;
      ctx.fillRect(rx1, y1, boxW, boxH);

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(rx1, y1, boxW, boxH);

      // Dashed entry price line
      const ey = cs.priceToCoordinate(entryP);
      if (ey !== null && ey >= y1 && ey <= y2 + 1) {
        ctx.strokeStyle = 'rgba(247,147,26,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rx1, ey);
        ctx.lineTo(rx1 + boxW, ey);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label if box is wide enough
      if (boxW > 28) {
        ctx.fillStyle = color;
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        const dir = t.direction === 'long' ? '▲' : '▼';
        ctx.fillText(`${dir} ${(t.setup_type || '').slice(0, 8)}`, rx1 + 3, y1 + 10);
      }
    });
  }, []);

  // ── Init chart + overlay canvas ────────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    if (!window.LightweightCharts) { setStatus('chart library not loaded'); return; }

    // Overlay canvas (pointer-events: none so chart stays interactive)
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    overlay.width  = containerRef.current.offsetWidth  || 900;
    overlay.height = containerRef.current.offsetHeight || 500;
    containerRef.current.appendChild(overlay);
    overlayRef.current = overlay;

    const chart = LightweightCharts.createChart(containerRef.current, {
      width:  containerRef.current.offsetWidth  || 900,
      height: containerRef.current.offsetHeight || 500,
      layout: { background: { color: '#0d0d11' }, textColor: '#5a5a6e' },
      grid:   { vertLines: { color: '#1a1a22' }, horzLines: { color: '#1a1a22' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1f1f28' },
      timeScale: { borderColor: '#1f1f28', timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    });

    const candle = chart.addCandlestickSeries({
      upColor: '#00d084', downColor: '#ff4d6d',
      borderUpColor: '#00d084', borderDownColor: '#ff4d6d',
      wickUpColor:   '#00d084', wickDownColor:   '#ff4d6d',
    });

    const vol = chart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // Redraw boxes on pan / zoom
    chart.timeScale().subscribeVisibleTimeRangeChange(() => drawBoxes());
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawBoxes());

    chart.subscribeCrosshairMove(param => {
      if (!param?.seriesData) return;
      const cd = param.seriesData.get(candle);
      if (cd) setHeaderInfo(cd);
    });

    // Resize observer
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.resize(width, height);
        overlay.width  = width;
        overlay.height = height;
        drawBoxes();
      }
    });
    ro.observe(containerRef.current);

    chartRef.current  = chart;
    candleRef.current = candle;
    volRef.current    = vol;

    return () => {
      ro.disconnect();
      // Remove overlay canvas from DOM before destroying chart
      if (overlayRef.current) { overlayRef.current.remove(); overlayRef.current = null; }
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volRef.current    = null;
      priceLineRef.current = null;
    };
  }, []);

  // Keep trades ref in sync
  React.useEffect(() => {
    tradesRef.current = data.trades || [];
    drawBoxes();
  }, [data.trades, drawBoxes]);

  // ── Resize when tab becomes visible (pages use display:none) ──────────────
  React.useEffect(() => {
    if (activePage !== 'chart') return;
    if (!chartRef.current || !containerRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    if (w > 0 && h > 0) {
      chartRef.current.resize(w, h);
      if (overlayRef.current) { overlayRef.current.width = w; overlayRef.current.height = h; }
      drawBoxes();
    }
  }, [activePage, drawBoxes]);

  // ── Fetch candles ──────────────────────────────────────────────────────────
  const loadCandles = React.useCallback(() => {
    if (!candleRef.current) return;
    const iv    = INTERVAL[tf];
    const limit = tf === 'W' ? 200 : 500;

    const parseKlines = arr => arr.map(k => ({
      time:  Math.floor(k[0] / 1000),
      open:  parseFloat(k[1]), high:  parseFloat(k[2]),
      low:   parseFloat(k[3]), close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const applyData = rows => {
      if (!candleRef.current) return;
      candleRef.current.setData(rows.map(({ time, open, high, low, close }) =>
        ({ time, open, high, low, close })));
      volRef.current.setData(rows.map(({ time, volume, open, close }) => ({
        time, value: volume,
        color: close >= open ? 'rgba(0,208,132,0.3)' : 'rgba(255,77,109,0.25)',
      })));
      setHeaderInfo(rows[rows.length - 1]);
      setTimeout(() => { chartRef.current?.timeScale().fitContent(); drawBoxes(); }, 120);
    };

    fetch(BINANCE(iv, limit))
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(arr => { if (!Array.isArray(arr) || !arr.length) throw 0; return arr; })
      .then(arr => { applyData(parseKlines(arr)); setStatus('Binance · live'); })
      .catch(() =>
        fetch(BINANCE_US(iv, limit))
          .then(r => { if (!r.ok) throw 0; return r.json(); })
          .then(arr => { if (!Array.isArray(arr) || !arr.length) throw 0; return arr; })
          .then(arr => { applyData(parseKlines(arr)); setStatus('Binance US · live'); })
          .catch(() => setStatus('feed offline'))
      );
  }, [tf, drawBoxes]);

  React.useEffect(() => {
    setStatus('loading…');
    const t  = setTimeout(loadCandles, 150);
    const id = setInterval(loadCandles, 5 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadCandles]);

  // ── Live price ticker ──────────────────────────────────────────────────────
  React.useEffect(() => {
    const fetchPrice = () =>
      fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
        .then(r => r.json())
        .then(t => {
          if (!t?.price) return;
          const p = parseFloat(t.price);
          setLivePrice(p);
          livePriceRef.current = p;
          if (!candleRef.current) return;
          if (priceLineRef.current) {
            priceLineRef.current.applyOptions({ price: p });
          } else {
            priceLineRef.current = candleRef.current.createPriceLine({
              price: p, color: '#F7931A', lineWidth: 1,
              lineStyle: 2, axisLabelVisible: true, title: 'live',
            });
          }
          drawBoxes();
        })
        .catch(() => {});
    fetchPrice();
    const id = setInterval(fetchPrice, 15000);
    return () => clearInterval(id);
  }, [drawBoxes]);

  const price = livePrice || headerInfo?.close || 0;

  const tfBtnStyle = active => ({
    padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 600,
    background: active ? 'rgba(247,147,26,0.15)' : 'transparent',
    color:      active ? '#F7931A' : '#3e3e52',
    outline:    active ? '1px solid rgba(247,147,26,0.3)' : 'none',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ padding: '28px 32px', fontFamily: "'Space Grotesk', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ece9e2' }}>BTC / USDT</div>
          <div style={{ fontSize: 11, color: status.includes('offline') ? '#ff4d6d' : '#3e3e52', marginTop: 3 }}>
            {status}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, background: '#0d0d11',
                      border: '1px solid #1f1f28', borderRadius: 8, padding: 4 }}>
          {['1H','4H','D','W'].map(t => (
            <button key={t} onClick={() => setTf(t)} style={tfBtnStyle(tf === t)}>{t}</button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace", color: '#ece9e2' }}>
            {price > 0 ? '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          </div>
          {headerInfo && (
            <div style={{ fontSize: 11, marginTop: 2, fontFamily: "'JetBrains Mono', monospace",
                          color: headerInfo.close >= headerInfo.open ? '#00d084' : '#ff4d6d' }}>
              {headerInfo.close >= headerInfo.open ? '+' : ''}
              {((headerInfo.close - headerInfo.open) / headerInfo.open * 100).toFixed(2)}%
            </div>
          )}
        </div>

        {headerInfo && (
          <div style={{ display: 'flex', gap: 20 }}>
            {[['O', headerInfo.open], ['H', headerInfo.high], ['L', headerInfo.low], ['C', headerInfo.close]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#3e3e52' }}>{k}</span>
                <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#ece9e2' }}>
                  ${(+v).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart + overlay wrapper */}
      <div style={{ background: '#0d0d11', border: '1px solid #1f1f28',
                    borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: 500, position: 'relative' }} />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 10, padding: '0 4px' }}>
        <span style={{ fontSize: 11, color: '#00d084' }}>■ TP hit</span>
        <span style={{ fontSize: 11, color: '#ff4d6d' }}>■ SL hit</span>
        <span style={{ fontSize: 11, color: '#F7931A' }}>■ Open / Trail stop</span>
        <span style={{ fontSize: 11, color: '#5a5a6e' }}>Dashed = entry price · Drag to pan · Scroll to zoom</span>
      </div>
    </div>
  );
}

Object.assign(window, { ChartPage });
