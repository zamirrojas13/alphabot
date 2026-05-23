
// ── helpers (local, do not depend on Telegram.jsx scope) ────────────────────
function mb_detectBrief(raw) {
  const r = raw.toLowerCase();
  return r.includes('brief') || r.includes('📋') || r.includes('morning');
}
function mb_extractTs(raw) {
  const m = raw.match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2})/);
  return m ? m[1] : null;
}
function mb_strip(raw) {
  return raw
    .replace(/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?(\s*UTC)?/, '')
    .replace(/^[\s\-|]*INFO[\s\-|]*/i, '')
    .replace(/^[\s\-|]*Telegram[\s\-:]+/i, '')
    .replace(/^[\s\-|]*Sent[\s\-:]+/i, '')
    .replace(/^[\s\-|]*Brief[\s\-:]+/i, '')
    .trim();
}
function mb_toET(raw) {
  try {
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + ':00Z');
    return d.toLocaleDateString('en-US', { timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric' });
  } catch { return raw?.slice(0,10) || '—'; }
}
function mb_countdown() {
  const now = new Date(), next = new Date();
  next.setUTCHours(10, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const diff = next - now;
  return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`;
}

// ── parse sections out of brief body ─────────────────────────────────────────
function parseBriefSections(text) {
  const HEADS = [
    { re: /bias|direction|outlook|btc/i,           title: '📊 BTC Bias' },
    { re: /level|support|resistance|key\s*level/i, title: '📍 Key Levels' },
    { re: /setup|pattern|signal|watching|active/i, title: '🔍 Active Setups' },
    { re: /risk|streak|drawdown|restrict/i,        title: '⚠ Risk Status' },
  ];
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) { if (cur) cur.lines.push(''); continue; }
    const head = t.length < 60 && HEADS.find(h => h.re.test(t));
    if (head) { cur = { title: head.title, lines: [] }; sections.push(cur); }
    else if (cur) cur.lines.push(t);
  }
  // Only return parsed sections if we got at least 2
  return sections.length >= 2 ? sections : null;
}

// ── Brief history row ─────────────────────────────────────────────────────────
function BriefHistoryRow({ brief }) {
  const [open, setOpen] = React.useState(false);
  const preview = brief.body.split('\n').find(l => l.trim()) || brief.body.slice(0, 100);
  return (
    <div onClick={() => setOpen(o => !o)}
      style={{ background: open ? 'rgba(167,139,250,0.04)' : 'transparent',
        border: `1px solid ${open ? 'rgba(167,139,250,0.15)' : '#15151d'}`,
        borderRadius: 7, padding: '9px 12px', cursor: 'pointer', transition: 'all 0.12s', marginBottom: 3 }}>
      <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
        <span style={{ fontSize:11, fontWeight:700, color:'#a78bfa', flexShrink:0,
          fontFamily:"'JetBrains Mono',monospace", minWidth:100 }}>
          {mb_toET(brief.ts)}
        </span>
        <div style={{ flex:1, fontSize:11, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.55,
          color: open ? '#ece9e2' : '#5a5a6e',
          whiteSpace: open ? 'pre-wrap' : 'nowrap', overflow: open ? 'visible' : 'hidden',
          textOverflow: open ? 'unset' : 'ellipsis', wordBreak:'break-word' }}>
          {open ? brief.body : preview}
        </div>
        <span style={{ fontSize:9, color:'#2a2a38', flexShrink:0, paddingTop:2 }}>{open ? '▲' : '▼'}</span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
function MorningBrief() {
  const [briefs,    setBriefs]    = React.useState(null);
  const [loading,   setLoading]   = React.useState(true);
  const [countdown, setCountdown] = React.useState(mb_countdown());

  React.useEffect(() => {
    const load = () => {
      fetch('/api/briefs').then(r => r.ok ? r.json() : null)
        .then(d => { setBriefs(d?.briefs || []); setLoading(false); })
        .catch(() => setLoading(false));
    };
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    const id = setInterval(() => setCountdown(mb_countdown()), 30000);
    return () => clearInterval(id);
  }, []);

  // briefs from /api/briefs: [{ts, body}] sorted newest-first

  const allBriefs  = briefs || [];
  const todayStr   = new Date().toISOString().slice(0, 10);
  const todayBrief = allBriefs.find(b => b.ts?.startsWith(todayStr));
  const history    = allBriefs.filter(b => !b.ts?.startsWith(todayStr)).slice(0, 14);

  return (
    <div style={mbStyles.wrap}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22 }}>
        <div>
          <div style={mbStyles.pageTitle}>Morning Brief</div>
          <div style={{ fontSize:12, color:'#3e3e52', marginTop:4 }}>
            Daily BTC market summary · 10:00 UTC · 6:00 AM ET
          </div>
        </div>
        <div style={{ background:'#111116', border:'1px solid rgba(167,139,250,0.2)', borderRadius:10, padding:'14px 20px', textAlign:'right' }}>
          <div style={{ fontSize:10, color:'#3e3e52', letterSpacing:'0.4px', marginBottom:4 }}>NEXT BRIEF IN</div>
          <div style={{ fontSize:22, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#a78bfa' }}>{countdown}</div>
          <div style={{ fontSize:10, color:'#2a2a38', marginTop:2 }}>10:00 UTC · 6:00 AM ET</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'60px', color:'#3e3e52' }}>Loading briefs from bot log…</div>
      ) : todayBrief ? (
        <div style={mbStyles.todayCard}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <span style={{ fontSize:18 }}>☀</span>
              <span style={{ fontSize:14, fontWeight:700, color:'#a78bfa' }}>Today's Morning Brief</span>
            </div>
            <span style={{ fontSize:11, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace" }}>{todayStr}</span>
          </div>
          {(() => {
            const sections = parseBriefSections(todayBrief.body);
            if (sections) {
              return (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {sections.map((s, i) => (
                    <div key={i} style={{ background:'#0d0d11', borderRadius:8, padding:'12px 14px', border:'1px solid #1a1a22' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#a78bfa', marginBottom:8 }}>{s.title}</div>
                      <div style={{ fontSize:11, color:'#ece9e2', lineHeight:1.7, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'pre-wrap' }}>
                        {s.lines.filter(Boolean).join('\n') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            return (
              <div style={{ fontSize:12, color:'#ece9e2', lineHeight:1.8, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'pre-wrap' }}>
                {todayBrief.body}
              </div>
            );
          })()}
        </div>
      ) : (
        <div style={{ background:'rgba(167,139,250,0.05)', border:'1px solid rgba(167,139,250,0.15)',
          borderRadius:10, padding:'36px', textAlign:'center', marginBottom:20 }}>
          <div style={{ fontSize:32, marginBottom:12, opacity:0.2 }}>☀</div>
          <div style={{ fontSize:14, fontWeight:700, color:'#a78bfa', marginBottom:8 }}>No brief yet today</div>
          <div style={{ fontSize:12, color:'#3e3e52', marginBottom:14 }}>Daily brief arrives at 10:00 UTC · 6:00 AM ET</div>
          <div style={{ fontSize:24, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#a78bfa' }}>{countdown}</div>
          <div style={{ fontSize:11, color:'#2a2a38', marginTop:4 }}>until next brief</div>
        </div>
      )}

      {/* Brief count summary */}
      {!loading && (
        <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center' }}>
          <span style={{ fontSize:12, color:'#3e3e52' }}>
            {allBriefs.length} brief{allBriefs.length !== 1 ? 's' : ''} in history
          </span>
          {allBriefs.length === 0 && (
            <span style={{ fontSize:11, color:'#2a2a38' }}>· Briefs appear here after 10:00 UTC each day</span>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={mbStyles.card}>
          <div style={mbStyles.cardTitle}>
            Brief History
            <span style={{ fontSize:11, color:'#3e3e52', fontWeight:400, marginLeft:8 }}>
              last {history.length} briefs · click to expand
            </span>
          </div>
          <div style={{ marginTop:12 }}>
            {history.map((b, i) => <BriefHistoryRow key={i} brief={b} />)}
          </div>
        </div>
      )}
    </div>
  );
}

const mbStyles = {
  wrap:      { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  todayCard: { background:'#111116', border:'1px solid rgba(167,139,250,0.2)', borderRadius:10, padding:'20px 22px', marginBottom:14 },
  card:      { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'18px 22px', marginBottom:14 },
  cardTitle: { fontSize:13, fontWeight:600, color:'#ece9e2' },
};

Object.assign(window, { MorningBrief });
