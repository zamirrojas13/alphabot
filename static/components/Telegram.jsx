
// ── helpers ────────────────────────────────────────────────────────────────

function toEastern(raw) {
  // raw = "2026-05-03 10:00" or ISO string
  try {
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + ':00Z');
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: true,
    });
  } catch { return raw; }
}

function extractTimestamp(raw) {
  const m = raw.match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function detectType(raw) {
  const r = raw.toLowerCase();
  if (r.includes('brief') || r.includes('📋') || r.includes('morning')) return 'brief';
  if (r.includes('signal') || r.includes('📈') || r.includes('📉') || r.includes('entry')) return 'signal';
  if (r.includes('scan') || r.includes('🔍') || r.includes('bias')) return 'scan';
  if (r.includes('win') || r.includes('loss') || r.includes('closed') || r.includes('tp hit') || r.includes('sl hit')) return 'trade';
  return 'info';
}

function stripLogPrefix(raw) {
  // Remove common log prefixes like "2026-05-03 10:00:15 UTC - INFO - Telegram: "
  return raw
    .replace(/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?(\s*UTC)?/,'')
    .replace(/^[\s\-|]*INFO[\s\-|]*/i,'')
    .replace(/^[\s\-|]*Telegram[\s\-:]+/i,'')
    .replace(/^[\s\-|]*Sent[\s\-:]+/i,'')
    .trim();
}

function getNextBriefCountdown() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(10, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const diff = next - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return { label: `${h}h ${m}m`, h, m };
}

// ── message card ─────────────────────────────────────────────────────────────

function MessageBubble({ raw }) {
  const type = detectType(raw);
  const ts   = extractTimestamp(raw);
  const body = stripLogPrefix(raw);

  const typeMap = {
    signal: { icon:'📈', label:'Signal Alert', color:'#00d084',  bg:'rgba(0,208,132,0.06)',  border:'rgba(0,208,132,0.15)' },
    brief:  { icon:'📋', label:'Daily Brief',  color:'#a78bfa',  bg:'rgba(167,139,250,0.06)',border:'rgba(167,139,250,0.15)' },
    scan:   { icon:'🔍', label:'Scan',         color:'#5a5a6e',  bg:'rgba(90,90,110,0.06)',  border:'rgba(90,90,110,0.2)' },
    trade:  { icon:'💰', label:'Trade',        color:'#F7931A',  bg:'rgba(247,147,26,0.06)', border:'rgba(247,147,26,0.2)' },
    info:   { icon:'ℹ️', label:'Info',         color:'#3e3e52',  bg:'rgba(62,62,82,0.06)',   border:'rgba(62,62,82,0.2)' },
  };
  const t = typeMap[type];

  return (
    <div style={{background: t.bg, border:`1px solid ${t.border}`, borderRadius:10, padding:'12px 16px', marginBottom:8}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{fontSize:14}}>{t.icon}</span>
          <span style={{fontSize:11, fontWeight:700, color: t.color, letterSpacing:'0.5px', textTransform:'uppercase'}}>{t.label}</span>
        </div>
        <div style={{textAlign:'right'}}>
          {ts && (
            <>
              <div style={{fontSize:10, color:'#5a5a6e', fontFamily:"'JetBrains Mono',monospace"}}>{toEastern(ts)} ET</div>
              <div style={{fontSize:9, color:'#2a2a38', fontFamily:"'JetBrains Mono',monospace"}}>{ts} UTC</div>
            </>
          )}
        </div>
      </div>
      <div style={{fontSize:12, color:'#ece9e2', lineHeight:1.7, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'pre-wrap', wordBreak:'break-word'}}>
        {body || raw}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

function TelegramPage({ data }) {
  const [filter,      setFilter]      = React.useState('all');
  const [tgData,      setTgData]      = React.useState(null);   // from /api/telegram
  const [loading,     setLoading]     = React.useState(true);
  const [countdown,   setCountdown]   = React.useState(getNextBriefCountdown());

  // Fetch Telegram status + messages
  React.useEffect(() => {
    const load = () => {
      setLoading(true);
      fetch('/api/telegram')
        .then(r => r.ok ? r.json() : null)
        .then(d => { setTgData(d); setLoading(false); })
        .catch(() => setLoading(false));
    };
    load();
    const id = setInterval(load, 60000);   // refresh every 60s
    return () => clearInterval(id);
  }, []);

  // Countdown ticker
  React.useEffect(() => {
    const id = setInterval(() => setCountdown(getNextBriefCountdown()), 30000);
    return () => clearInterval(id);
  }, []);

  const messages  = tgData?.messages || [];
  const connected = tgData?.connected ?? false;
  const botName   = tgData?.bot_username ? `@${tgData.bot_username}` : '@AlphaBotBTC';

  // Count by type
  const counts = { signal:0, brief:0, scan:0, trade:0 };
  messages.forEach(m => {
    const t = detectType(m.raw);
    if (counts[t] !== undefined) counts[t]++;
  });

  const filtered = filter === 'all' ? messages : messages.filter(m => detectType(m.raw) === filter);

  // ── connection status ──
  const connColor  = loading ? '#5a5a6e' : connected ? '#00d084' : '#ff4d6d';
  const connLabel  = loading ? 'CHECKING…' : connected ? 'BOT RUNNING' : 'BOT OFFLINE';
  const connGlow   = loading ? 'none' : connected ? '0 0 6px #00d084' : '0 0 6px #ff4d6d44';

  return (
    <div style={tgStyles.wrap}>

      {/* Header */}
      <div style={tgStyles.header}>
        <div>
          <div style={tgStyles.pageTitle}>Telegram</div>
          <div style={tgStyles.pageSub}>
            One-way alerts · {botName} · Morning brief 10:00 UTC (6:00 AM ET)
          </div>
        </div>
        <div style={{...tgStyles.connBadge, borderColor: connected ? 'rgba(0,208,132,0.2)' : 'rgba(255,77,109,0.2)', background: connected ? 'rgba(0,208,132,0.07)' : 'rgba(255,77,109,0.05)'}}>
          <span style={{width:7, height:7, borderRadius:'50%', background:connColor, boxShadow:connGlow, display:'inline-block', flexShrink:0}}></span>
          <span style={{fontSize:11, color:connColor, fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{connLabel}</span>
        </div>
      </div>

      {/* Info bar — Next brief, timezone note, message counts */}
      <div style={tgStyles.infoBar}>

        <div style={tgStyles.infoCard}>
          <div style={tgStyles.infoLabel}>Next Morning Brief</div>
          <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#a78bfa'}}>{countdown.label}</div>
          <div style={{fontSize:10, color:'#3e3e52', marginTop:3}}>Daily at 10:00 UTC · 6:00 AM ET</div>
        </div>

        <div style={tgStyles.infoCard}>
          <div style={tgStyles.infoLabel}>Messages Loaded</div>
          <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#ece9e2'}}>{messages.length}</div>
          <div style={{fontSize:10, color:'#3e3e52', marginTop:3}}>from bot.log · last 300 entries</div>
        </div>

        <div style={tgStyles.infoCard}>
          <div style={tgStyles.infoLabel}>Signals</div>
          <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#00d084'}}>{counts.signal}</div>
          <div style={{fontSize:10, color:'#3e3e52', marginTop:3}}>trade alerts sent</div>
        </div>

        <div style={tgStyles.infoCard}>
          <div style={tgStyles.infoLabel}>Briefs</div>
          <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#a78bfa'}}>{counts.brief}</div>
          <div style={{fontSize:10, color:'#3e3e52', marginTop:3}}>morning summaries</div>
        </div>

        <div style={tgStyles.infoCard}>
          <div style={tgStyles.infoLabel}>Scans</div>
          <div style={{fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:'#5a5a6e'}}>{counts.scan}</div>
          <div style={{fontSize:10, color:'#3e3e52', marginTop:3}}>market scans</div>
        </div>

        {/* What the bot sends */}
        <div style={{...tgStyles.infoCard, flex:2, background:'rgba(167,139,250,0.04)', borderColor:'rgba(167,139,250,0.12)'}}>
          <div style={tgStyles.infoLabel}>What this bot sends you</div>
          <div style={{display:'flex', flexDirection:'column', gap:4, marginTop:6}}>
            {[
              ['📋','Daily Brief 6am ET — BTC bias, key levels, what to watch'],
              ['📈','Signal Alert — entry, SL, TP, R:R when a pattern triggers'],
              ['💰','Trade Close — result, R multiple, running P&L'],
              ['🔍','Scan Result — every 15min scan summary when relevant'],
            ].map(([icon, desc]) => (
              <div key={icon} style={{fontSize:11, color:'#5a5a6e', display:'flex', gap:8}}>
                <span>{icon}</span><span>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter tabs + feed */}
      <div style={{background:'#111116', border:'1px solid #1f1f28', borderRadius:10, overflow:'hidden'}}>

        {/* Tab bar */}
        <div style={{display:'flex', gap:0, borderBottom:'1px solid #1a1a22', background:'#0d0d11', padding:'0 16px'}}>
          {[
            { key:'all',    label:`All  (${messages.length})` },
            { key:'signal', label:`📈 Signals (${counts.signal})` },
            { key:'brief',  label:`📋 Briefs (${counts.brief})` },
            { key:'scan',   label:`🔍 Scans (${counts.scan})` },
            { key:'trade',  label:`💰 Trades (${counts.trade})` },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{...tgStyles.tab, ...(filter===f.key ? tgStyles.tabActive : {})}}>
              {f.label}
            </button>
          ))}
          <div style={{flex:1}}></div>
          <div style={{display:'flex', alignItems:'center', gap:6, fontSize:10, color:'#2a2a38', padding:'0 8px'}}>
            All times shown in ET · UTC shown below each message
          </div>
        </div>

        {/* Feed */}
        <div style={{padding:'16px', maxHeight:520, overflowY:'auto'}}>
          {loading ? (
            <div style={{textAlign:'center', padding:'40px', color:'#3e3e52'}}>
              <div style={{fontSize:20, marginBottom:8, opacity:0.3}}>⟳</div>
              <div style={{fontSize:13}}>Connecting to Oracle bot log…</div>
            </div>
          ) : filtered.length > 0 ? (
            [...filtered].reverse().map((m, i) => (
              <MessageBubble key={i} raw={m.raw} />
            ))
          ) : (
            <div style={{textAlign:'center', padding:'48px 24px'}}>
              <div style={{fontSize:28, marginBottom:12, opacity:0.1}}>✦</div>
              <div style={{fontSize:14, color:'#3e3e52', marginBottom:8}}>
                {messages.length === 0
                  ? 'No Telegram messages found in bot log yet'
                  : `No ${filter} messages in log`}
              </div>
              <div style={{fontSize:12, color:'#2a2a38', lineHeight:1.7}}>
                {messages.length === 0 ? (
                  <>
                    Your bot sends messages directly to your Telegram.<br/>
                    They'll appear here once the bot has been running and generating alerts.<br/>
                    <span style={{color:'#3e3e52'}}>Next morning brief in {countdown.label} (6:00 AM ET)</span>
                  </>
                ) : `Switch to "All" to see other message types`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Suggested features note */}
      <div style={{marginTop:12, padding:'12px 16px', background:'rgba(247,147,26,0.04)', border:'1px solid rgba(247,147,26,0.1)', borderRadius:8, display:'flex', gap:10, alignItems:'flex-start'}}>
        <span style={{fontSize:14, flexShrink:0}}>💡</span>
        <div style={{fontSize:11, color:'#3e3e52', lineHeight:1.7}}>
          <span style={{color:'#F7931A', fontWeight:600}}>Coming features (need Oracle update):</span>
          {' '}Send a test ping to verify delivery · Webhook for instant message push (no polling) ·
          {' '}Custom alert thresholds — e.g. only notify when R:R ≥ 3× · Mute hours (e.g. silence 10pm–6am ET)
        </div>
      </div>

    </div>
  );
}

const tgStyles = {
  wrap:      { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  header:    { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', letterSpacing:'-0.5px' },
  pageSub:   { fontSize:12, color:'#3e3e52', marginTop:4 },
  connBadge: { display:'flex', alignItems:'center', gap:8, border:'1px solid', padding:'9px 16px', borderRadius:8 },
  infoBar:   { display:'flex', gap:10, marginBottom:14 },
  infoCard:  { flex:1, background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'14px 16px' },
  infoLabel: { fontSize:10, color:'#3e3e52', letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:6 },
  tab:       { padding:'11px 16px', border:'none', borderBottom:'2px solid transparent', background:'transparent', color:'#3e3e52', fontSize:12, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif", fontWeight:500, whiteSpace:'nowrap', transition:'all 0.15s' },
  tabActive: { color:'#F7931A', borderBottomColor:'#F7931A' },
};

Object.assign(window, { TelegramPage });
