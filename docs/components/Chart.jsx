
// ── Chart helpers ────────────────────────────────────────────────────────────
function computeEMA(closes, n) {
  const k = 2 / (n + 1);
  let ema = closes[0];
  return closes.map((c, i) => { ema = i === 0 ? c : c * k + ema * (1 - k); return ema; });
}

function computeATR(rows, n = 14) {
  const trs = rows.map((r, i) => {
    if (i === 0) return r.high - r.low;
    const pc = rows[i - 1].close;
    return Math.max(r.high - r.low, Math.abs(r.high - pc), Math.abs(r.low - pc));
  });
  return trs.slice(-n).reduce((s, v) => s + v, 0) / n;
}

function computeWilliamsR(rows, n) {
  const out = [];
  for (let i = n - 1; i < rows.length; i++) {
    const slice = rows.slice(i - n + 1, i + 1);
    const hh = Math.max(...slice.map(s => s.high));
    const ll = Math.min(...slice.map(s => s.low));
    const val = hh === ll ? -50 : +((hh - rows[i].close) / (hh - ll) * -100).toFixed(2);
    out.push({ time: rows[i].time, value: val });
  }
  return out;
}

function getPrevWeeklyOpens(rows, n = 3) {
  const opens = [];
  let lastWk = -1;
  for (const r of rows) {
    const wk = Math.floor((new Date(r.time * 1000).getTime() - 4 * 86400000) / (7 * 86400000));
    if (wk !== lastWk) { opens.push({ price: r.open, time: r.time }); lastWk = wk; }
  }
  return opens.slice(-(n + 1), -1);
}

function getWeeklyOpen(rows) {
  const now = new Date();
  const dow = now.getUTCDay();
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  mon.setUTCHours(0, 0, 0, 0);
  const monSec = Math.floor(mon.getTime() / 1000);
  const wk = rows.filter(r => r.time >= monSec);
  return wk.length ? wk[0].open : null;
}

function getMonthOpen(rows) {
  const now = new Date();
  const ms = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  const mo = rows.filter(r => r.time >= ms);
  return mo.length ? mo[0].open : null;
}

function chartApplyRange(chart, range, rows) {
  if (!chart) return;
  if (range === 'ALL') { try { chart.timeScale().fitContent(); } catch(e) {} return; }
  const days = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }[range];
  if (days) {
    const now = Math.floor(Date.now() / 1000);
    try { chart.timeScale().setVisibleRange({ from: now - days * 86400, to: now + 3600 }); } catch(e) {}
    return;
  }
  if (rows && rows.length > 200) {
    try { chart.timeScale().setVisibleLogicalRange({ from: rows.length - 200, to: rows.length + 2 }); } catch(e) {}
  } else {
    try { chart.timeScale().fitContent(); } catch(e) {}
  }
}

// Binary-search snap: find closest candle bar time
function makeSap(rows) {
  const times = rows.map(r => r.time);
  return sec => {
    if (!times.length) return sec;
    let lo = 0, hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= sec) lo = mid; else hi = mid - 1;
    }
    if (lo < times.length - 1) {
      return Math.abs(times[lo] - sec) <= Math.abs(times[lo + 1] - sec) ? times[lo] : times[lo + 1];
    }
    return times[lo];
  };
}

// ── Main component ────────────────────────────────────────────────────────────
function ChartPage({ data, activePage, viewMode }) {
  // Chart instance refs
  const containerRef   = React.useRef(null);
  const wrContainerRef = React.useRef(null);
  const overlayRef     = React.useRef(null);
  const chartRef       = React.useRef(null);
  const wrChartRef     = React.useRef(null);
  const candleRef      = React.useRef(null);
  const volRef         = React.useRef(null);
  const ema50Ref       = React.useRef(null);
  const ema200Ref      = React.useRef(null);
  const wr14Ref        = React.useRef(null);
  const wr28Ref        = React.useRef(null);
  const weeklyLineRef  = React.useRef(null);
  const prevWkLinesRef = React.useRef([]);
  const monthLineRef   = React.useRef(null);
  const priceLineRef   = React.useRef(null);
  const livePriceRef   = React.useRef(null);
  // Data refs
  const rawRowsRef         = React.useRef([]);
  const snapRef            = React.useRef(sec => sec);
  const filteredTradesRef  = React.useRef([]);
  const selectedTradeRef   = React.useRef(null);
  // Callback refs (avoid stale closures in chart subscriptions)
  const drawOverlayRef     = React.useRef(null);
  const applyMarkersRef    = React.useRef(null);
  // State refs
  const rangeRef           = React.useRef('200');
  const showEMARef         = React.useRef(true);
  const showTradesRef      = React.useRef(true);
  const syncingRef         = React.useRef(false);

  // ── State ──────────────────────────────────────────────────────────────────
  const [tf,           setTf]           = React.useState('4H');
  const [range,        setRange]        = React.useState('200');
  const [showEMA,      setShowEMA]      = React.useState(true);
  const [showWR,       setShowWR]       = React.useState(false);
  const [showTrades,   setShowTrades]   = React.useState(true);
  const [livePrice,    setLivePrice]    = React.useState(null);
  const [status,       setStatus]       = React.useState('connecting…');
  const [headerInfo,   setHeaderInfo]   = React.useState(null);
  const [tooltip,      setTooltip]      = React.useState(null);
  const [atrVal,       setAtrVal]       = React.useState(null);
  const [weeklyOpen,   setWeeklyOpen]   = React.useState(null);
  // Trade overlay state
  const [btTrades,     setBtTrades]     = React.useState([]);
  const [stratFilter,  setStratFilter]  = React.useState('ALL');
  const [resultFilter, setResultFilter] = React.useState('ALL');
  const [tradeLimit,   setTradeLimit]   = React.useState(50);
  const [selectedTrade,setSelectedTrade]= React.useState(null);
  const [selectedPos,  setSelectedPos]  = React.useState({ x: 20, y: 20 });
  const [hoverTrade,   setHoverTrade]   = React.useState(null);

  // Keep state refs in sync
  React.useEffect(() => { rangeRef.current      = range;      }, [range]);
  React.useEffect(() => { showEMARef.current    = showEMA;    }, [showEMA]);
  React.useEffect(() => { showTradesRef.current = showTrades; }, [showTrades]);
  React.useEffect(() => { selectedTradeRef.current = selectedTrade; }, [selectedTrade]);

  // ── Load backtest trades when mode = backtest ──────────────────────────────
  React.useEffect(() => {
    if (viewMode !== 'backtest') { setBtTrades([]); return; }
    fetch('/api/backtest').then(r => r.json()).then(d => setBtTrades(d.trades || [])).catch(() => {});
  }, [viewMode]);

  // ── Derived: all trades for current mode ──────────────────────────────────
  const allTrades = React.useMemo(() => {
    return viewMode === 'backtest' ? btTrades : (data.trades || []);
  }, [viewMode, btTrades, data.trades]);

  // ── Unique setups for filter dropdown ────────────────────────────────────
  const uniqueSetups = React.useMemo(() => {
    const seen = new Set();
    allTrades.forEach(t => { const s = t.setup_type || t.strat || ''; if (s) seen.add(s); });
    return [...seen].sort();
  }, [allTrades]);

  // ── Filtered trades ───────────────────────────────────────────────────────
  const filteredTrades = React.useMemo(() => {
    let trades = allTrades.filter(t => t.timestamp_entry && t.entry_price);
    if (stratFilter !== 'ALL') {
      trades = trades.filter(t => {
        const st = (t.setup_type || t.strat || '').toLowerCase();
        if (stratFilter === 'dir:long')  return (t.direction || 'long') === 'long';
        if (stratFilter === 'dir:short') return (t.direction || '') === 'short';
        if (stratFilter.startsWith('tf:')) {
          const f = stratFilter.slice(3);
          return st.includes(`_${f}_`) || st.endsWith(`_${f}`) || (t.timeframe || '').toLowerCase() === f;
        }
        if (stratFilter.startsWith('tier:')) return String(t.tier) === stratFilter.slice(5);
        return st === stratFilter || st.startsWith(stratFilter);
      });
    }
    if (resultFilter !== 'ALL') {
      trades = trades.filter(t => {
        const rm = parseFloat(t.r_multiple) || 0;
        const reason = (t.exit_reason || '').toLowerCase();
        if (resultFilter === 'win')  return rm > 0;
        if (resultFilter === 'loss') return rm < 0;
        if (resultFilter === 'time') return reason.includes('time') || reason === 'expire';
        return true;
      });
    }
    if (tradeLimit && trades.length > tradeLimit) trades = trades.slice(-tradeLimit);
    return trades;
  }, [allTrades, stratFilter, resultFilter, tradeLimit]);

  React.useEffect(() => { filteredTradesRef.current = filteredTrades; }, [filteredTrades]);

  // ── Draw overlay canvas (connecting lines + SL/TP rects) ─────────────────
  const drawOverlay = React.useCallback(() => {
    const canvas = overlayRef.current;
    const chart  = chartRef.current;
    const cs     = candleRef.current;
    if (!canvas || !chart || !cs) return;

    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (!showTradesRef.current) return;

    const trades = filteredTradesRef.current;
    const snap   = snapRef.current;
    const nowSec = Math.floor(Date.now() / 1000);

    // Connecting lines: entry price → exit price
    trades.forEach(t => {
      const entrySec = Math.floor(new Date(t.timestamp_entry).getTime() / 1000);
      const exitSec  = t.timestamp_exit ? Math.floor(new Date(t.timestamp_exit).getTime() / 1000) : nowSec;
      const x1 = chart.timeScale().timeToCoordinate(snap(entrySec));
      const x2 = chart.timeScale().timeToCoordinate(snap(exitSec));
      if (x1 === null || x2 === null) return;
      if (x1 < -100 && x2 < -100) return;
      if (x1 > W + 100 && x2 > W + 100) return;

      const ep = parseFloat(t.entry_price);
      const xp = t.exit_price ? parseFloat(t.exit_price) : ep;
      const y1 = cs.priceToCoordinate(ep);
      const y2 = cs.priceToCoordinate(xp);
      if (y1 === null || y2 === null) return;

      const rm  = parseFloat(t.r_multiple) || 0;
      const col = rm > 0 ? 'rgba(0,208,132,0.3)' : rm < 0 ? 'rgba(255,77,109,0.3)' : 'rgba(90,90,110,0.3)';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
    });

    // SL/TP zones for selected trade
    const sel = selectedTradeRef.current;
    if (sel && sel.entry_price) {
      const ep       = parseFloat(sel.entry_price);
      const sl       = sel.sl_price ? parseFloat(sel.sl_price) : null;
      const tp       = sel.tp_price ? parseFloat(sel.tp_price) : null;
      const eSec     = Math.floor(new Date(sel.timestamp_entry).getTime() / 1000);
      const xSec     = sel.timestamp_exit ? Math.floor(new Date(sel.timestamp_exit).getTime() / 1000) : nowSec;
      const x1       = chart.timeScale().timeToCoordinate(snap(eSec));
      const x2       = chart.timeScale().timeToCoordinate(snap(xSec));
      const entryY   = cs.priceToCoordinate(ep);
      if (x1 !== null && x2 !== null && entryY !== null) {
        const rx1  = Math.max(Math.min(x1, x2), 0);
        const rx2  = Math.min(Math.max(x1, x2), W);
        const boxW = Math.max(rx2 - rx1, 2);
        [{ price: tp, col: 'rgba(0,208,132', fill: 'rgba(0,208,132,0.08)' },
         { price: sl, col: 'rgba(255,77,109', fill: 'rgba(255,77,109,0.08)' }]
        .forEach(({ price: p, col, fill }) => {
          if (!p) return;
          const py = cs.priceToCoordinate(p);
          if (py === null) return;
          const y1 = Math.min(entryY, py), y2 = Math.max(entryY, py);
          ctx.fillStyle = fill;
          ctx.fillRect(rx1, y1, boxW, y2 - y1);
          ctx.strokeStyle = col + ',0.5)';
          ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.strokeRect(rx1, y1, boxW, y2 - y1);
        });
      }
    }
  }, []);

  React.useEffect(() => { drawOverlayRef.current = drawOverlay; }, [drawOverlay]);

  // ── Apply LightweightCharts markers ───────────────────────────────────────
  const applyTradeMarkers = React.useCallback(() => {
    const series = candleRef.current;
    if (!series) return;
    if (!showTradesRef.current) { try { series.setMarkers([]); } catch(e) {} return; }

    const trades = filteredTradesRef.current;
    const snap   = snapRef.current;
    const markers = [];

    trades.forEach(t => {
      const isLong   = (t.direction || 'long') === 'long';
      const eSec     = Math.floor(new Date(t.timestamp_entry).getTime() / 1000);
      const snappedE = snap(eSec);

      // Entry marker
      markers.push({
        time:     snappedE,
        position: isLong ? 'belowBar' : 'aboveBar',
        color:    isLong ? '#00d084' : '#ff4d6d',
        shape:    isLong ? 'arrowUp' : 'arrowDown',
        size:     1, text: '',
      });

      // Exit marker
      if (t.timestamp_exit && t.exit_price) {
        const xSec     = Math.floor(new Date(t.timestamp_exit).getTime() / 1000);
        const snappedX = snap(xSec);
        const reason   = (t.exit_reason || '').toLowerCase();
        const rm       = parseFloat(t.r_multiple) || 0;
        const isTP     = reason.includes('tp') || reason.includes('trail');
        const isSL     = reason.includes('sl') || reason.includes('stop');
        const exitCol  = rm > 0 ? '#00d084' : rm < 0 ? '#ff4d6d' : '#5a5a6e';
        const exitShape = isSL ? 'square' : 'circle';
        markers.push({
          time:     snappedX,
          position: isLong ? 'aboveBar' : 'belowBar',
          color:    exitCol,
          shape:    exitShape,
          size:     0, text: '',
        });
      }
    });

    markers.sort((a, b) => a.time - b.time);
    try { series.setMarkers(markers); } catch(e) {}
    // Also redraw canvas lines
    if (drawOverlayRef.current) drawOverlayRef.current();
  }, []);

  React.useEffect(() => { applyMarkersRef.current = applyTradeMarkers; }, [applyTradeMarkers]);

  // ── Init main chart + overlay + WR sub-chart (once) ──────────────────────
  React.useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    if (!window.LightweightCharts) { setStatus('chart library not loaded'); return; }

    // Overlay canvas for connecting lines
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;';
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
      wickUpColor: '#00d084', wickDownColor: '#ff4d6d',
    });
    const vol = chart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    const ema50Line = chart.addLineSeries({
      color: '#60a5fa', lineWidth: 1, priceLineVisible: false,
      lastValueVisible: true, title: 'EMA50', crosshairMarkerVisible: false,
    });
    const ema200Line = chart.addLineSeries({
      color: '#F7931A', lineWidth: 1, priceLineVisible: false,
      lastValueVisible: true, title: 'EMA200', crosshairMarkerVisible: false,
    });

    chartRef.current  = chart;
    candleRef.current = candle;
    volRef.current    = vol;
    ema50Ref.current  = ema50Line;
    ema200Ref.current = ema200Line;

    // Crosshair → tooltip + hover trade detection
    chart.subscribeCrosshairMove(param => {
      if (!param?.seriesData) { setTooltip(null); setHoverTrade(null); return; }
      const cd = param.seriesData.get(candle);
      if (!cd) { setTooltip(null); setHoverTrade(null); return; }
      setHeaderInfo(cd);
      if (param.point) {
        const rows = rawRowsRef.current;
        const idx  = param.logical != null ? Math.round(param.logical) : -1;
        const prev = idx > 0 && idx < rows.length ? rows[idx - 1] : null;
        setTooltip({ bar: cd, prev });
      } else { setTooltip(null); }
      // Hover trade
      if (param.time) {
        const barTime = param.time;
        const snap = snapRef.current;
        const hov = filteredTradesRef.current.find(t => {
          if (!t.timestamp_entry) return false;
          return snap(Math.floor(new Date(t.timestamp_entry).getTime() / 1000)) === barTime;
        });
        setHoverTrade(hov || null);
      } else { setHoverTrade(null); }
    });

    // Click → select trade
    chart.subscribeClick(param => {
      if (!param.time) { setSelectedTrade(null); return; }
      const barTime = param.time;
      const snap = snapRef.current;
      const trade = filteredTradesRef.current.find(t => {
        if (!t.timestamp_entry) return false;
        return snap(Math.floor(new Date(t.timestamp_entry).getTime() / 1000)) === barTime;
      });
      setSelectedTrade(trade || null);
      if (trade && param.point) setSelectedPos({ x: param.point.x, y: param.point.y });
    });

    // Scroll → redraw overlay
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (drawOverlayRef.current) drawOverlayRef.current();
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (drawOverlayRef.current) drawOverlayRef.current();
      // Sync to WR chart
      if (syncingRef.current || !r || !wrChartRef.current) return;
      syncingRef.current = true;
      try { wrChartRef.current.timeScale().setVisibleLogicalRange(r); } catch(e) {}
      syncingRef.current = false;
    });

    // WR sub-chart
    if (wrContainerRef.current) {
      const wrChart = LightweightCharts.createChart(wrContainerRef.current, {
        width:  wrContainerRef.current.offsetWidth  || 900,
        height: wrContainerRef.current.offsetHeight || 110,
        layout: { background: { color: '#0d0d11' }, textColor: '#5a5a6e' },
        grid:   { vertLines: { color: '#1a1a22' }, horzLines: { color: '#14141c' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1f1f28', scaleMargins: { top: 0.05, bottom: 0.05 } },
        timeScale: { borderColor: '#1f1f28', visible: false },
        handleScroll: false, handleScale: false,
      });
      const wr14 = wrChart.addLineSeries({
        color: '#22d3ee', lineWidth: 1, priceLineVisible: false,
        lastValueVisible: true, title: 'W%R(14)', crosshairMarkerVisible: true,
      });
      const wr28 = wrChart.addLineSeries({
        color: '#a78bfa', lineWidth: 1, priceLineVisible: false,
        lastValueVisible: true, title: 'W%R(28)', crosshairMarkerVisible: false,
      });
      wrChartRef.current = wrChart;
      wr14Ref.current    = wr14;
      wr28Ref.current    = wr28;
    }

    // Resize observer
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.resize(width, height);
        overlay.width  = width;
        overlay.height = height;
        if (drawOverlayRef.current) drawOverlayRef.current();
        if (wrChartRef.current && wrContainerRef.current)
          wrChartRef.current.resize(wrContainerRef.current.offsetWidth, wrContainerRef.current.offsetHeight || 110);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      overlay.remove(); overlayRef.current = null;
      chart.remove();
      if (wrChartRef.current) { try { wrChartRef.current.remove(); } catch(e) {} wrChartRef.current = null; }
      chartRef.current = null; candleRef.current = null; volRef.current = null;
      ema50Ref.current = null; ema200Ref.current = null;
      wr14Ref.current = null; wr28Ref.current = null;
      weeklyLineRef.current = null; priceLineRef.current = null; monthLineRef.current = null;
      prevWkLinesRef.current = [];
    };
  }, []); // eslint-disable-line

  // Sync filtered trades → markers + overlay
  React.useEffect(() => {
    filteredTradesRef.current = filteredTrades;
    if (applyMarkersRef.current) applyMarkersRef.current();
  }, [filteredTrades]);

  // Sync selected trade → overlay redraw
  React.useEffect(() => {
    selectedTradeRef.current = selectedTrade;
    if (drawOverlayRef.current) drawOverlayRef.current();
  }, [selectedTrade]);

  // Resize when tab becomes visible
  React.useEffect(() => {
    if (activePage !== 'chart' || !chartRef.current || !containerRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    if (w > 0 && h > 0) {
      chartRef.current.resize(w, h);
      if (overlayRef.current) { overlayRef.current.width = w; overlayRef.current.height = h; }
      if (drawOverlayRef.current) drawOverlayRef.current();
    }
    if (wrChartRef.current && wrContainerRef.current)
      wrChartRef.current.resize(wrContainerRef.current.offsetWidth, wrContainerRef.current.offsetHeight || 110);
  }, [activePage]);

  // Toggle EMA visibility
  React.useEffect(() => {
    ema50Ref.current?.applyOptions({ visible: showEMA });
    ema200Ref.current?.applyOptions({ visible: showEMA });
  }, [showEMA]);

  // Toggle trades
  React.useEffect(() => {
    if (applyMarkersRef.current) applyMarkersRef.current();
    if (drawOverlayRef.current) drawOverlayRef.current();
  }, [showTrades]);

  // Apply range (no refetch)
  React.useEffect(() => {
    chartApplyRange(chartRef.current, range, rawRowsRef.current);
    if (wrChartRef.current) chartApplyRange(wrChartRef.current, range, rawRowsRef.current);
  }, [range]);

  const INTERVAL = { '1H': '1h', '4H': '4h', 'D': '1d', 'W': '1w' };

  // ── Apply all data to charts ───────────────────────────────────────────────
  const applyData = React.useCallback((rows) => {
    if (!candleRef.current || !rows.length) return;
    rawRowsRef.current = rows;
    snapRef.current    = makeSap(rows);

    candleRef.current.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    volRef.current.setData(rows.map(({ time, volume, open, close }) => ({
      time, value: volume, color: close >= open ? 'rgba(0,208,132,0.3)' : 'rgba(255,77,109,0.25)',
    })));

    const closes   = rows.map(r => r.close);
    const e50Data  = rows.map((r, i) => ({ time: r.time, value: +computeEMA(closes, 50)[i].toFixed(2) }));
    const e200Data = rows.map((r, i) => ({ time: r.time, value: +computeEMA(closes, 200)[i].toFixed(2) }));
    ema50Ref.current?.setData(showEMARef.current ? e50Data : []);
    ema200Ref.current?.setData(showEMARef.current ? e200Data : []);

    if (rows.length >= 14) setAtrVal(Math.round(computeATR(rows)));

    // Current weekly open
    const wo = getWeeklyOpen(rows);
    setWeeklyOpen(wo);
    if (weeklyLineRef.current) { try { candleRef.current?.removePriceLine(weeklyLineRef.current); } catch(e) {} weeklyLineRef.current = null; }
    if (wo && candleRef.current) {
      weeklyLineRef.current = candleRef.current.createPriceLine({
        price: wo, color: 'rgba(167,139,250,0.75)', lineWidth: 1,
        lineStyle: 2, axisLabelVisible: true, title: 'This Week',
      });
    }

    // Previous weekly opens: Wk-1, Wk-2, Wk-3
    prevWkLinesRef.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch(e) {} });
    prevWkLinesRef.current = [];
    getPrevWeeklyOpens(rows, 3).forEach(({ price: p }, i) => {
      const opacity = [0.55, 0.35, 0.18][i];
      const showLabel = i < 2; // label Wk-1 and Wk-2
      try {
        const pl = candleRef.current.createPriceLine({
          price: p, color: `rgba(167,139,250,${opacity})`,
          lineWidth: 1, lineStyle: 2,
          axisLabelVisible: showLabel,
          title: showLabel ? `Wk-${i + 1}` : '',
        });
        prevWkLinesRef.current.push(pl);
      } catch(e) {}
    });

    // Monthly open
    if (monthLineRef.current) { try { candleRef.current?.removePriceLine(monthLineRef.current); } catch(e) {} monthLineRef.current = null; }
    const mo = getMonthOpen(rows);
    if (mo && mo !== wo && candleRef.current) {
      monthLineRef.current = candleRef.current.createPriceLine({
        price: mo, color: 'rgba(167,139,250,0.45)', lineWidth: 1,
        lineStyle: 3, axisLabelVisible: true, title: 'Month Open',
      });
    }

    // Williams %R
    if (wr14Ref.current && wr28Ref.current) {
      wr14Ref.current.setData(computeWilliamsR(rows, 14));
      wr28Ref.current.setData(computeWilliamsR(rows, 28));
    }

    // Trade markers + overlay
    if (applyMarkersRef.current) applyMarkersRef.current();

    setHeaderInfo(rows[rows.length - 1]);
    setTimeout(() => {
      chartApplyRange(chartRef.current, rangeRef.current, rows);
      if (wrChartRef.current) chartApplyRange(wrChartRef.current, rangeRef.current, rows);
    }, 120);
  }, []); // stable — uses only refs

  // ── Load candles: parquet history + live patch ────────────────────────────
  const loadCandles = React.useCallback(() => {
    if (!candleRef.current) return;
    const iv = INTERVAL[tf];
    setStatus('loading…');

    const parseKlines = arr => arr.map(k => ({
      time:   Math.floor(k[0] / 1000),
      open:   parseFloat(k[1]), high:  parseFloat(k[2]),
      low:    parseFloat(k[3]), close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const mergeRows = (history, live) => {
      const map = new Map();
      history.forEach(r => map.set(r.time, r));
      live.forEach(r => map.set(r.time, r));
      return [...map.values()].sort((a, b) => a.time - b.time);
    };

    const BINANCE    = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=500`;
    const BINANCE_US = `https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=500`;

    const fetchLive = () =>
      fetch(BINANCE).then(r => { if (!r.ok) throw 0; return r.json(); })
        .then(arr => { if (!Array.isArray(arr) || !arr.length) throw 0; return arr; })
        .catch(() => fetch(BINANCE_US).then(r => { if (!r.ok) throw 0; return r.json(); })
          .then(arr => { if (!Array.isArray(arr) || !arr.length) throw 0; return arr; }));

    fetch(`/api/chart/history?tf=${iv}&limit=0`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => {
        if (!d.candles?.length) throw 0;
        return fetchLive()
          .then(live => { applyData(mergeRows(d.candles, parseKlines(live))); setStatus('Parquet + live'); })
          .catch(() => { applyData(d.candles); setStatus('Parquet (live offline)'); });
      })
      .catch(() =>
        fetchLive()
          .then(live => { applyData(parseKlines(live)); setStatus('Binance · live only'); })
          .catch(() => setStatus('feed offline'))
      );
  }, [tf, applyData]);

  React.useEffect(() => {
    setStatus('loading…');
    const t  = setTimeout(loadCandles, 150);
    const id = setInterval(loadCandles, 5 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadCandles]);

  // ── Live price ticker ─────────────────────────────────────────────────────
  React.useEffect(() => {
    const fetchPrice = () =>
      fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
        .then(r => r.json()).then(t => {
          if (!t?.price) return;
          const p = parseFloat(t.price);
          setLivePrice(p); livePriceRef.current = p;
          if (!candleRef.current) return;
          if (priceLineRef.current) {
            priceLineRef.current.applyOptions({ price: p });
          } else {
            priceLineRef.current = candleRef.current.createPriceLine({
              price: p, color: '#F7931A', lineWidth: 1,
              lineStyle: 2, axisLabelVisible: true, title: 'live',
            });
          }
        }).catch(() => {});
    fetchPrice();
    const id = setInterval(fetchPrice, 15000);
    return () => clearInterval(id);
  }, []);

  // ── UI styles ─────────────────────────────────────────────────────────────
  const price = livePrice || headerInfo?.close || 0;

  const btnBase = (active, accent) => ({
    padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
    fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 600,
    background: active ? `rgba(${accent},0.15)` : 'transparent',
    color:      active ? `rgb(${accent})` : '#3e3e52',
    outline:    active ? `1px solid rgba(${accent},0.3)` : 'none',
    transition: 'all 0.15s',
  });
  const tfBtn  = act => btnBase(act, '247,147,26');
  const rngBtn = act => btnBase(act, '96,165,250');
  const togBtn = (act, col) => ({
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${act ? col : '#1f1f28'}`,
    cursor: 'pointer', fontSize: 11, fontWeight: 600,
    background: act ? `${col}22` : 'transparent',
    color: act ? col : '#3e3e52', transition: 'all 0.15s',
    fontFamily: "'Space Grotesk', sans-serif",
  });
  const selectStyle = (active) => ({
    background: '#0d0d11', border: `1px solid ${active ? '#F7931A' : '#1f1f28'}`,
    borderRadius: 5, color: active ? '#F7931A' : '#5a5a6e',
    padding: '4px 8px', fontSize: 11, cursor: 'pointer',
    fontFamily: "'Space Grotesk', sans-serif", outline: 'none',
  });

  // Selected trade card
  const renderSelectedCard = () => {
    if (!selectedTrade) return null;
    const t   = selectedTrade;
    const rm  = parseFloat(t.r_multiple) || 0;
    const pnl = parseFloat(t.pnl_net_usd) || 0;
    const SN  = window.STRAT_NAMES || {};
    const name= SN[(t.setup_type||'').toLowerCase()] || t.setup_type || '?';
    const dir = (t.direction || 'long') === 'long';
    const rmCol = rm > 0 ? '#00d084' : rm < 0 ? '#ff4d6d' : '#5a5a6e';
    const reason = t.exit_reason || '—';
    return (
      <div style={{
        position:'absolute',
        top: Math.min(selectedPos.y + 15, 260),
        left: Math.min(selectedPos.x + 15, (containerRef.current?.offsetWidth || 600) - 220),
        zIndex: 30, background: '#13131b',
        border: '1px solid #2a2a38', borderRadius: 9,
        padding: '10px 14px', minWidth: 200, maxWidth: 230,
        fontFamily: "'Space Grotesk', sans-serif", fontSize: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
          <span style={{ color:'#F7931A', fontWeight:700, fontSize:11, lineHeight:1.3, maxWidth:170 }}>{name}</span>
          <button onClick={() => setSelectedTrade(null)} style={{
            background:'none', border:'none', color:'#3e3e52', cursor:'pointer', fontSize:15, padding:0, lineHeight:1,
          }}>✕</button>
        </div>
        <div style={{ color: dir ? '#00d084' : '#ff4d6d', fontWeight:700, marginBottom:7, fontSize:13 }}>
          {dir ? '▲ LONG' : '▼ SHORT'}
        </div>
        {[
          ['Entry',  `$${(+t.entry_price).toLocaleString('en-US')}`,       '#ece9e2'],
          ['Exit',   t.exit_price ? `$${(+t.exit_price).toLocaleString('en-US')}` : '—', '#ece9e2'],
          ['Reason', reason,                                                '#ece9e2'],
          ['R mult', `${rm >= 0 ? '+' : ''}${rm.toFixed(2)}R`,            rmCol],
          ['PnL',    pnl ? `${pnl >= 0 ? '+$' : '-$'}${Math.abs(pnl).toFixed(2)}` : '—', rmCol],
        ].map(([k, v, c]) => (
          <div key={k} style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:3 }}>
            <span style={{ color:'#5a5a6e' }}>{k}</span>
            <span style={{ color: c, fontWeight: k==='R mult' ? 700 : 400 }}>{v}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', padding:'16px 24px 10px',
                  fontFamily:"'Space Grotesk', sans-serif", boxSizing:'border-box', overflow:'hidden' }}>

      {/* ── Header row 1: price info + TF/Range ── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8, flexWrap:'wrap' }}>
        <div style={{ minWidth:90 }}>
          <div style={{ fontSize:18, fontWeight:700, color:'#ece9e2' }}>BTC / USD</div>
          <div style={{ fontSize:10, color: status.includes('offline') ? '#ff4d6d' : '#3e3e52', marginTop:2 }}>{status}</div>
        </div>

        <div style={{ display:'flex', gap:2, background:'#0d0d11', border:'1px solid #1f1f28', borderRadius:7, padding:3 }}>
          {['1H','4H','D','W'].map(t => (
            <button key={t} onClick={() => setTf(t)} style={tfBtn(tf === t)}>{t}</button>
          ))}
        </div>

        <div style={{ display:'flex', gap:2, background:'#0d0d11', border:'1px solid #1f1f28', borderRadius:7, padding:3 }}>
          {[['200','200'],['1M','1M'],['3M','3M'],['6M','6M'],['1Y','1Y'],['ALL','ALL']].map(([r,lbl]) => (
            <button key={r} onClick={() => setRange(r)} style={rngBtn(range === r)}>{lbl}</button>
          ))}
        </div>

        {atrVal != null && (
          <span style={{ fontSize:11, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace" }}>
            ATR(14): ${atrVal.toLocaleString()}
          </span>
        )}

        {/* Toggles */}
        <div style={{ display:'flex', gap:5, alignItems:'center' }}>
          <button onClick={() => setShowEMA(v => !v)} style={togBtn(showEMA, '#60a5fa')}>EMA</button>
          <button onClick={() => setShowWR(v => !v)}  style={togBtn(showWR,  '#22d3ee')}>W%R</button>
          <button onClick={() => setShowTrades(v => !v)} style={togBtn(showTrades, '#F7931A')}>
            📒 {filteredTrades.length > 0 && showTrades ? `Trades (${filteredTrades.length})` : 'Trades'}
          </button>
        </div>

        {/* Live price */}
        <div style={{ marginLeft:'auto', textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:22, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2' }}>
            {price > 0 ? '$' + price.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—'}
          </div>
          {headerInfo && (
            <div style={{ fontSize:11, marginTop:1, fontFamily:"'JetBrains Mono',monospace",
                          color: headerInfo.close >= headerInfo.open ? '#00d084' : '#ff4d6d' }}>
              {headerInfo.close >= headerInfo.open ? '+' : ''}
              {((headerInfo.close - headerInfo.open) / headerInfo.open * 100).toFixed(2)}%
            </div>
          )}
        </div>

        {/* OHLC */}
        {headerInfo && (
          <div style={{ display:'flex', gap:12, flexShrink:0 }}>
            {[['O',headerInfo.open],['H',headerInfo.high],['L',headerInfo.low],['C',headerInfo.close]].map(([k,v]) => (
              <div key={k} style={{ display:'flex', gap:4, alignItems:'center' }}>
                <span style={{ fontSize:10, color:'#3e3e52' }}>{k}</span>
                <span style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2' }}>
                  ${(+v).toLocaleString('en-US', { maximumFractionDigits:0 })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Header row 2: trade filters (shown when trades toggle is on) ── */}
      {showTrades && (
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
          <select value={stratFilter} onChange={e => setStratFilter(e.target.value)} style={selectStyle(stratFilter !== 'ALL')}>
            <option value="ALL">Strategy: ALL</option>
            <optgroup label="Timeframe">
              <option value="tf:1h">1H only</option>
              <option value="tf:4h">4H only</option>
              <option value="tf:1d">Daily only</option>
              <option value="tf:1w">Weekly only</option>
            </optgroup>
            <optgroup label="Tier">
              <option value="tier:1">Tier 1 only</option>
              <option value="tier:2">Tier 2 only</option>
              <option value="tier:3">Tier 3 only</option>
            </optgroup>
            <optgroup label="Direction">
              <option value="dir:long">Longs only</option>
              <option value="dir:short">Shorts only</option>
            </optgroup>
            {uniqueSetups.length > 0 && (
              <optgroup label="Individual">
                {uniqueSetups.map(s => (
                  <option key={s} value={s.toLowerCase()}>
                    {(window.STRAT_NAMES||{})[s.toLowerCase()] || s}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}
            style={{ ...selectStyle(resultFilter !== 'ALL'), color: resultFilter !== 'ALL' ? '#60a5fa' : '#5a5a6e', border: `1px solid ${resultFilter !== 'ALL' ? '#60a5fa' : '#1f1f28'}` }}>
            <option value="ALL">Result: ALL</option>
            <option value="win">Winners only</option>
            <option value="loss">Losses only</option>
            <option value="time">Time exits only</option>
          </select>

          {allTrades.length > 50 && (
            <select value={tradeLimit || 'all'} onChange={e => setTradeLimit(e.target.value === 'all' ? 0 : +e.target.value)}
              style={{ ...selectStyle(false), color:'#5a5a6e' }}>
              <option value="50">Last 50</option>
              <option value="100">Last 100</option>
              <option value="200">Last 200</option>
              <option value="all">All {allTrades.length}</option>
            </select>
          )}

          {(stratFilter !== 'ALL' || resultFilter !== 'ALL') && (
            <button onClick={() => { setStratFilter('ALL'); setResultFilter('ALL'); }}
              style={{ ...togBtn(false,'#5a5a6e'), fontSize:10, padding:'3px 8px' }}>
              Clear filters
            </button>
          )}

          <span style={{ fontSize:10, color:'#3e3e52', marginLeft:4 }}>
            {filteredTrades.length} trade{filteredTrades.length !== 1 ? 's' : ''} shown
            {viewMode === 'backtest' ? ' · backtest' : ''}
          </span>
        </div>
      )}

      {/* ── Main chart ── */}
      <div style={{ flex:1, background:'#0d0d11', border:'1px solid #1f1f28',
                    borderRadius: showWR ? '10px 10px 0 0' : 10,
                    overflow:'hidden', position:'relative', minHeight:280 }}>
        <div ref={containerRef} style={{ width:'100%', height:'100%', position:'relative' }} />

        {/* Floating OHLCV tooltip */}
        {tooltip && (() => {
          const b = tooltip.bar;
          const chg = tooltip.prev ? ((b.close - tooltip.prev.close) / tooltip.prev.close * 100) : null;
          const d = new Date(b.time * 1000);
          const isUp = b.close >= b.open;
          return (
            <div style={{
              position:'absolute', top:10, left:10, zIndex:10,
              background:'rgba(13,13,17,0.92)', border:'1px solid #1f1f28',
              borderRadius:7, padding:'8px 12px', pointerEvents:'none',
              fontFamily:"'JetBrains Mono',monospace", fontSize:11, minWidth:190,
            }}>
              <div style={{ color:'#5a5a6e', marginBottom:5, fontSize:10 }}>
                {d.toUTCString().slice(0,22)} UTC
              </div>
              {[['Open',b.open],['High',b.high],['Low',b.low],['Close',b.close]].map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', gap:16, marginBottom:2 }}>
                  <span style={{ color:'#3e3e52' }}>{k}</span>
                  <span style={{ color: k==='Close' ? (isUp?'#00d084':'#ff4d6d') : '#ece9e2' }}>
                    ${(+v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                  </span>
                </div>
              ))}
              {b.volume != null && (
                <div style={{ display:'flex', justifyContent:'space-between', gap:16, marginBottom:2 }}>
                  <span style={{ color:'#3e3e52' }}>Vol</span>
                  <span style={{ color:'#ece9e2' }}>{(+b.volume).toFixed(2)} BTC</span>
                </div>
              )}
              {chg !== null && (
                <div style={{ display:'flex', justifyContent:'space-between', gap:16, marginTop:4, paddingTop:4, borderTop:'1px solid #1a1a22' }}>
                  <span style={{ color:'#3e3e52' }}>Chg</span>
                  <span style={{ color: chg>=0?'#00d084':'#ff4d6d' }}>{chg>=0?'+':''}{chg.toFixed(2)}%</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Hover mini-tooltip (when no card selected) */}
        {hoverTrade && !selectedTrade && (() => {
          const t  = hoverTrade;
          const rm = parseFloat(t.r_multiple) || 0;
          const SN = window.STRAT_NAMES || {};
          const name = SN[(t.setup_type||'').toLowerCase()] || t.setup_type || '?';
          return (
            <div style={{
              position:'absolute', bottom:12, left:'50%', transform:'translateX(-50%)',
              zIndex:25, background:'rgba(13,13,23,0.9)', border:'1px solid #2a2a38',
              borderRadius:5, padding:'5px 12px',
              fontFamily:"'Space Grotesk', sans-serif", fontSize:11, color:'#ece9e2',
              pointerEvents:'none', whiteSpace:'nowrap',
            }}>
              {name} · <span style={{ color: rm>0?'#00d084':'#ff4d6d', fontWeight:700 }}>
                {rm>=0?'+':''}{rm.toFixed(2)}R {rm>0?'✅':'❌'}
              </span>
              <span style={{ color:'#5a5a6e', marginLeft:8, fontSize:10 }}>Click to pin</span>
            </div>
          );
        })()}

        {/* Selected trade card */}
        {renderSelectedCard()}
      </div>

      {/* ── Williams %R sub-panel ── */}
      <div style={{
        height: showWR ? 130 : 0, overflow:'hidden', transition:'height 0.2s',
        background:'#0d0d11', border: showWR ? '1px solid #1f1f28' : 'none',
        borderTop: 'none', borderRadius:'0 0 10px 10px',
      }}>
        <div style={{ padding:'4px 10px 0', display:'flex', gap:14, alignItems:'center' }}>
          <span style={{ fontSize:10, color:'#22d3ee', fontFamily:"'JetBrains Mono',monospace" }}>W%R(14)</span>
          <span style={{ fontSize:10, color:'#a78bfa', fontFamily:"'JetBrains Mono',monospace" }}>W%R(28)</span>
          <span style={{ fontSize:9, color:'rgba(0,208,132,0.55)' }}>─── −80 oversold</span>
          <span style={{ fontSize:9, color:'rgba(255,77,109,0.55)' }}>─── −20 overbought</span>
        </div>
        <div ref={wrContainerRef} style={{ width:'100%', height:106 }} />
      </div>

      {/* ── Legend ── */}
      <div style={{ display:'flex', gap:16, marginTop:7, padding:'0 2px', flexWrap:'wrap', flexShrink:0 }}>
        <span style={{ fontSize:11, color:'#00d084' }}>▲ Long entry</span>
        <span style={{ fontSize:11, color:'#ff4d6d' }}>▼ Short entry</span>
        <span style={{ fontSize:11, color:'rgba(167,139,250,0.8)' }}>── Weekly/Month opens</span>
        {weeklyOpen && (
          <span style={{ fontSize:11, color:'rgba(167,139,250,0.6)' }}>
            This week: ${weeklyOpen.toLocaleString('en-US', { maximumFractionDigits:0 })}
          </span>
        )}
        <span style={{ fontSize:11, color:'#5a5a6e', marginLeft:'auto' }}>
          Click marker to pin · Scroll to zoom · Parquet history to 2017
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { ChartPage });
