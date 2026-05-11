
function CoinbaseAccount({ data }) {
  const [cb, setCb]     = React.useState(null);
  const [status, setStatus] = React.useState('loading…');

  const load = () => {
    fetch('/api/coinbase')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setStatus('API unreachable'); return; }
        if (!d.configured) { setStatus('not configured'); setCb(d); return; }
        if (d.err)  { setStatus('error: ' + d.err); return; }
        setCb(d);
        setStatus('live');
      })
      .catch(e => setStatus('error: ' + e.message));
  };

  React.useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);

  const mono = { fontFamily: "'JetBrains Mono', monospace" };
  const card = { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 20px' };
  const lbl  = { fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:6 };
  const val  = { fontSize:22, fontWeight:700, ...mono };
  const row  = { display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'9px 0', borderBottom:'1px solid #111116' };
  const th   = { fontSize:10, color:'#3e3e52', fontWeight:600, letterSpacing:'0.4px',
                  padding:'9px 12px', background:'#0d0d11', borderBottom:'1px solid #1a1a22' };
  const td   = { padding:'9px 12px', fontSize:12, ...mono, color:'#ece9e2', verticalAlign:'middle' };

  return (
    <div style={{ padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box',
                  fontFamily:"'Space Grotesk', sans-serif" }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' }}>
            Coinbase Account
          </div>
          <div style={{ fontSize:11, marginTop:4,
            color: status === 'live' ? '#00d084' : status === 'not configured' ? '#F7931A' : '#ff4d6d' }}>
            {status === 'live' ? '● Live' : status === 'not configured' ? '⚠ API key not configured' : '● ' + status}
          </div>
        </div>
        <button onClick={load}
          style={{ padding:'7px 16px', borderRadius:7, border:'1px solid #1f1f28',
                   background:'#111116', color:'#5a5a6e', fontSize:12,
                   fontFamily:"'Space Grotesk',sans-serif", cursor:'pointer' }}>
          Refresh
        </button>
      </div>

      {/* Not configured */}
      {cb && !cb.configured && (
        <div style={{ background:'rgba(247,147,26,0.06)', border:'1px solid rgba(247,147,26,0.2)',
                      borderRadius:10, padding:'20px 24px', marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#F7931A', marginBottom:8 }}>Setup Required</div>
          <div style={{ fontSize:13, color:'#ece9e2', lineHeight:1.7 }}>
            1. Go to <span style={{ color:'#F7931A', ...mono }}>coinbase.com/settings/api</span><br/>
            2. Click <b>New API Key</b> → select your portfolio<br/>
            3. Enable <b>View</b> permission (read-only — no trading needed)<br/>
            4. Copy your <b>API Key</b> and <b>API Secret</b><br/>
            5. Open the file below and paste them in:
          </div>
          <div style={{ marginTop:12, padding:'10px 14px', background:'#0d0d11', borderRadius:7,
                        border:'1px solid #1f1f28', fontSize:12, color:'#5a5a6e', ...mono }}>
            alphabot/.keys/coinbase.json
          </div>
          <div style={{ marginTop:8, fontSize:11, color:'#3e3e52' }}>
            Then restart serve.py and refresh this page.
          </div>
        </div>
      )}

      {cb && cb.configured && !cb.err && (
        <>
          {/* Balance cards */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:20 }}>
            <div style={card}>
              <div style={lbl}>Total Portfolio (USD)</div>
              <div style={{...val, color:'#F7931A'}}>
                ${(cb.total_usd || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}
              </div>
              {cb.btc_price && (
                <div style={{ fontSize:11, color:'#3e3e52', marginTop:6, ...mono }}>
                  BTC @ ${cb.btc_price.toLocaleString('en-US')}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={lbl}>BTC Holdings</div>
              <div style={{...val, color:'#ece9e2'}}>
                {cb.btc != null ? cb.btc.toFixed(8) : '—'} <span style={{fontSize:14, color:'#3e3e52'}}>BTC</span>
              </div>
              {cb.btc != null && cb.btc_price && (
                <div style={{ fontSize:11, color:'#5a5a6e', marginTop:6, ...mono }}>
                  ≈ ${(cb.btc * cb.btc_price).toLocaleString('en-US', {maximumFractionDigits:2})}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={lbl}>USD / Stablecoin</div>
              <div style={{...val, color:'#ece9e2'}}>
                ${(cb.usd || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}
              </div>
              <div style={{ fontSize:11, color:'#3e3e52', marginTop:6 }}>Cash available</div>
            </div>
          </div>

          {/* All accounts table */}
          {cb.accounts?.length > 0 && (
            <div style={{ background:'#111116', border:'1px solid #1f1f28', borderRadius:10,
                          overflow:'hidden', marginBottom:20 }}>
              <div style={{ padding:'14px 18px', borderBottom:'1px solid #1a1a22',
                            fontSize:13, fontWeight:600, color:'#ece9e2' }}>
                All Balances
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    {['Currency','Available','On Hold','Total'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cb.accounts.map(a => (
                    <tr key={a.currency} style={{ borderBottom:'1px solid #15151d' }}>
                      <td style={{...td, fontWeight:700, color:'#F7931A'}}>{a.currency}</td>
                      <td style={td}>{a.available.toLocaleString('en-US', {maximumFractionDigits:8})}</td>
                      <td style={{...td, color:'#5a5a6e'}}>{a.hold > 0 ? a.hold.toLocaleString('en-US', {maximumFractionDigits:8}) : '—'}</td>
                      <td style={{...td, fontWeight:700}}>{a.total.toLocaleString('en-US', {maximumFractionDigits:8})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Open orders */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div style={{ background:'#111116', border:'1px solid #1f1f28', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'14px 18px', borderBottom:'1px solid #1a1a22',
                            fontSize:13, fontWeight:600, color:'#ece9e2' }}>
                Open Orders <span style={{ fontSize:11, color:'#3e3e52', marginLeft:6 }}>
                  ({cb.open_orders?.length ?? 0})
                </span>
              </div>
              {!cb.open_orders?.length ? (
                <div style={{ padding:'28px', textAlign:'center', color:'#3e3e52', fontSize:12 }}>
                  No open orders
                </div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>{['Product','Side','Size','Price','Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cb.open_orders.map((o,i) => (
                      <tr key={o.order_id || i} style={{ borderBottom:'1px solid #15151d' }}>
                        <td style={{...td, color:'#F7931A'}}>{o.product_id}</td>
                        <td style={{...td, color: o.side==='BUY'?'#00d084':'#ff4d6d', fontWeight:700}}>{o.side}</td>
                        <td style={td}>{o.size ?? '—'}</td>
                        <td style={td}>{o.price ? '$'+parseFloat(o.price).toLocaleString('en-US') : 'MKT'}</td>
                        <td style={{...td, color:'#5a5a6e'}}>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Recent fills */}
            <div style={{ background:'#111116', border:'1px solid #1f1f28', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'14px 18px', borderBottom:'1px solid #1a1a22',
                            fontSize:13, fontWeight:600, color:'#ece9e2' }}>
                Recent Fills <span style={{ fontSize:11, color:'#3e3e52', marginLeft:6 }}>
                  ({cb.recent_fills?.length ?? 0})
                </span>
              </div>
              {!cb.recent_fills?.length ? (
                <div style={{ padding:'28px', textAlign:'center', color:'#3e3e52', fontSize:12 }}>
                  No recent fills
                </div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>{['Time','Product','Side','Price','Size','Fee'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cb.recent_fills.map((f,i) => (
                      <tr key={f.trade_id || i} style={{ borderBottom:'1px solid #15151d' }}>
                        <td style={{...td, fontSize:10, color:'#5a5a6e'}}>{f.time}</td>
                        <td style={{...td, color:'#F7931A'}}>{f.product_id}</td>
                        <td style={{...td, color: f.side==='BUY'?'#00d084':'#ff4d6d', fontWeight:700}}>{f.side}</td>
                        <td style={td}>${f.price.toLocaleString('en-US', {maximumFractionDigits:2})}</td>
                        <td style={td}>{f.size}</td>
                        <td style={{...td, color:'#5a5a6e'}}>${f.fee.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {cb?.err && (
        <div style={{ background:'rgba(255,77,109,0.06)', border:'1px solid rgba(255,77,109,0.2)',
                      borderRadius:10, padding:'16px 20px', color:'#ff4d6d', fontSize:13 }}>
          API Error: {cb.err}
        </div>
      )}
    </div>
  );
}

window.CoinbaseAccount = CoinbaseAccount;
