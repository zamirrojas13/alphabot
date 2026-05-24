
const NAV_ITEMS = [
  { id: 'overview',    label: 'Overview',     icon: '▦' },
  { id: 'chart',       label: 'Chart',        icon: '◈' },
  { id: 'bot',         label: 'Bot Control',  icon: '◎' },
  { id: 'journal',     label: 'Journal',      icon: '≡' },
  { id: 'ledger',      label: 'Ledger',       icon: '◫' },
  { id: 'analytics',   label: 'Analytics',    icon: '◉' },
  { id: 'performance', label: 'Performance',  icon: '▤' },
  { id: 'risk',        label: 'Risk',         icon: '◬' },
  { id: 'signal',      label: 'Signal Check', icon: '◐' },
  { id: 'strategy',    label: 'Strategy',     icon: '◇' },
  { id: 'telegram',    label: 'Telegram',     icon: '✦' },
  { id: 'brief',       label: 'Morning Brief',icon: '☀' },
  { id: 'coinbase',    label: 'Coinbase',     icon: '₿' },
  { id: 'brain',         label: 'Brain',        icon: '◆' },
  { id: 'brain-journal', label: 'Brain Journal', icon: '◗' },
  { id: 'brain-ledger',  label: 'Brain Ledger',  icon: '◑' },
];

const MODE_CFG = {
  live:      { label:'LIVE',      dot:'#00d084', bg:'rgba(0,208,132,0.12)',    border:'rgba(0,208,132,0.35)',    text:'#00d084' },
  paper:     { label:'PAPER',     dot:'#F7931A', bg:'rgba(247,147,26,0.14)',   border:'rgba(247,147,26,0.35)',   text:'#F7931A' },
  backtest:  { label:'BKTEST',    dot:'#38bdf8', bg:'rgba(56,189,248,0.12)',   border:'rgba(56,189,248,0.3)',    text:'#38bdf8' },
};

function Sidebar({ active, setActive, botStatus, viewMode, setViewMode, data }) {
  const statusColor = botStatus === 'running' ? '#00d084' : botStatus === 'paused' ? '#F7931A' : '#ff4d6d';
  const statusLabel = botStatus === 'running' ? 'LIVE' : botStatus === 'paused' ? 'PAUSED' : 'STOPPED';

  // ── notification badge logic ────────────────────────────────────────────────
  const lossStreak  = data?.bot_state?.loss_streak || 0;
  const ddPct       = Math.abs(data?.bot_state?.portfolio_dd_pct || 0);
  const recentClosed = (data?.trades || []).filter(t => !t.open).slice(-10);
  const wr10 = recentClosed.length >= 3
    ? recentClosed.filter(t => (t.r_multiple || 0) > 0).length / recentClosed.length * 100
    : null;

  const [version, setVersion] = React.useState('v2.5.0');
  const [deployDate, setDeployDate] = React.useState(() => new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }));
  React.useEffect(() => {
    fetch('/health').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.bot_version) setVersion(`v${d.bot_version}`);
      // Use today's date as deploy date (refreshes on server restart)
      setDeployDate(new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }));
    }).catch(() => {});
  }, []);

  const [tgBadge, setTgBadge] = React.useState(false);
  React.useEffect(() => {
    const check = () => {
      fetch('/api/telegram').then(r => r.ok ? r.json() : null).then(d => {
        if (!d?.messages?.length) { setTgBadge(false); return; }
        const now = Date.now();
        const recent = d.messages.some(m => {
          const match = (m.raw || '').match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2})/);
          if (!match) return false;
          try {
            const t = new Date(match[1].replace(' ', 'T') + ':00Z');
            return (now - t.getTime()) < 15 * 60000;
          } catch { return false; }
        });
        setTgBadge(recent);
      }).catch(() => {});
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  const BADGES = {
    risk:     (ddPct > 5 || lossStreak >= 2) ? '#ff4d6d' : null,
    analytics:(wr10 !== null && wr10 < 45)   ? '#F7931A' : null,
    telegram:  tgBadge                        ? '#38bdf8' : null,
    bot:      (botStatus === 'paused' || botStatus === 'stopped') ? '#ff4d6d' : null,
  };

  return (
    <div style={sidebarStyles.wrap}>
      {/* Logo */}
      <div style={sidebarStyles.logo}>
        <span style={sidebarStyles.logoIcon}>₿</span>
        <div>
          <div style={sidebarStyles.logoName}>AlphaBot</div>
          <div style={sidebarStyles.logoSub}>BTC / USD · Coinbase</div>
        </div>
      </div>

      {/* Bot status badge */}
      <div style={sidebarStyles.statusBadge}>
        <span style={{...sidebarStyles.statusDot, background: statusColor, boxShadow: `0 0 6px ${statusColor}`}}></span>
        <span style={{...sidebarStyles.statusText, color: statusColor}}>{statusLabel}</span>
      </div>

      {/* Global mode selector */}
      <div style={{margin:'6px 10px 4px', display:'flex', gap:3}}>
        {['live','paper','backtest'].map(m => {
          const cfg = MODE_CFG[m];
          const active_m = viewMode === m;
          return (
            <button key={m} onClick={() => setViewMode(m)} style={{
              flex:1, padding:'5px 2px', borderRadius:5, border:'none', cursor:'pointer',
              fontSize:9, fontWeight:700, letterSpacing:'0.4px', textTransform:'uppercase',
              fontFamily:"'JetBrains Mono',monospace",
              background: active_m ? cfg.bg : 'transparent',
              color:      active_m ? cfg.text : '#3e3e52',
              boxShadow:  active_m ? `0 0 0 1px ${cfg.border}` : 'none',
              lineHeight: 1.3,
            }}>
              <span style={{display:'block', fontSize:8, marginBottom:1}}>{active_m ? '●' : '○'}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Nav */}
      <nav style={sidebarStyles.nav}>
        {NAV_ITEMS.map(item => {
          const badgeColor = BADGES[item.id] || null;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              style={{
                ...sidebarStyles.navItem,
                ...(active === item.id ? sidebarStyles.navItemActive : {}),
              }}
            >
              <span style={sidebarStyles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
              {active === item.id && <span style={sidebarStyles.navIndicator}></span>}
              {badgeColor && (
                <span style={{position:'absolute', top:6, right:active === item.id ? 10 : 6,
                  width:8, height:8, borderRadius:'50%', background:badgeColor,
                  boxShadow:`0 0 5px ${badgeColor}`, flexShrink:0}}></span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom info */}
      <div style={sidebarStyles.bottom}>
        <div style={sidebarStyles.bottomRow}>
          <span style={sidebarStyles.bottomLabel}>Coinbase</span>
          <span style={{...sidebarStyles.bottomVal, color: '#00d084'}}>● Connected</span>
        </div>
        <div style={sidebarStyles.bottomRow}>
          <span style={sidebarStyles.bottomLabel}>Ledger</span>
          <span style={{...sidebarStyles.bottomVal, color: '#00d084'}}>● Synced</span>
        </div>
        <div style={sidebarStyles.bottomRow}>
          <span style={sidebarStyles.bottomLabel}>Telegram</span>
          <span style={{...sidebarStyles.bottomVal, color: '#00d084'}}>● Active</span>
        </div>
        <div style={{...sidebarStyles.bottomRow, marginTop: 12, borderTop: '1px solid #1f1f28', paddingTop: 12}}>
          <span style={sidebarStyles.bottomLabel}>{version}</span>
          <span style={sidebarStyles.bottomVal}>{deployDate}</span>
        </div>
      </div>
    </div>
  );
}

const sidebarStyles = {
  wrap: {
    width: 200, minWidth: 200, height: '100vh', background: '#0d0d11',
    borderRight: '1px solid #1f1f28', display: 'flex', flexDirection: 'column',
    fontFamily: "'Space Grotesk', sans-serif",
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '22px 20px 18px', borderBottom: '1px solid #1f1f28',
  },
  logoIcon: {
    fontSize: 22, color: '#F7931A', fontWeight: 700,
    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(247,147,26,0.12)', borderRadius: 8,
  },
  logoName: { fontSize: 15, fontWeight: 700, color: '#ece9e2', letterSpacing: '-0.3px' },
  logoSub: { fontSize: 10, color: '#5a5a6e', letterSpacing: '0.5px', marginTop: 1 },
  statusBadge: {
    display: 'flex', alignItems: 'center', gap: 7,
    margin: '12px 16px', background: '#111116', borderRadius: 6,
    padding: '8px 12px', border: '1px solid #1f1f28',
  },
  statusDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusText: { fontSize: 11, fontWeight: 700, letterSpacing: '1px', fontFamily: "'JetBrains Mono', monospace" },
  nav: { flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '9px 12px', borderRadius: 7, border: 'none', background: 'transparent',
    color: '#5a5a6e', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    textAlign: 'left', position: 'relative', transition: 'all 0.15s',
    fontFamily: "'Space Grotesk', sans-serif",
  },
  navItemActive: { background: 'rgba(247,147,26,0.1)', color: '#F7931A' },
  navIcon: { fontSize: 14, width: 18, textAlign: 'center' },
  navIndicator: {
    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
    width: 3, height: 18, background: '#F7931A', borderRadius: '2px 0 0 2px',
  },
  bottom: { padding: '12px 16px 20px', borderTop: '1px solid #1f1f28' },
  bottomRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  bottomLabel: { fontSize: 11, color: '#3e3e52' },
  bottomVal: { fontSize: 11, color: '#5a5a6e', fontFamily: "'JetBrains Mono', monospace" },
};

Object.assign(window, { Sidebar });
