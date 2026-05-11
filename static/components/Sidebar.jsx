
const NAV_ITEMS = [
  { id: 'overview',  label: 'Overview',     icon: '▦' },
  { id: 'chart',     label: 'Chart',        icon: '◈' },
  { id: 'bot',       label: 'Bot Control',  icon: '◎' },
  { id: 'journal',   label: 'Journal',      icon: '≡' },
  { id: 'ledger',    label: 'Ledger',       icon: '◫' },
  { id: 'analytics', label: 'Analytics',    icon: '◉' },
  { id: 'risk',      label: 'Risk',         icon: '◬' },
  { id: 'signal',    label: 'Signal Check', icon: '◐' },
  { id: 'strategy',  label: 'Strategy',     icon: '◇' },
  { id: 'telegram',  label: 'Telegram',     icon: '✦' },
  { id: 'coinbase',  label: 'Coinbase',     icon: '₿' },
];

function Sidebar({ active, setActive, botStatus }) {
  const statusColor = botStatus === 'running' ? '#00d084' : botStatus === 'paused' ? '#F7931A' : '#ff4d6d';
  const statusLabel = botStatus === 'running' ? 'LIVE' : botStatus === 'paused' ? 'PAUSED' : 'STOPPED';

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

      {/* Nav */}
      <nav style={sidebarStyles.nav}>
        {NAV_ITEMS.map(item => (
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
          </button>
        ))}
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
          <span style={sidebarStyles.bottomLabel}>v2.4.2</span>
          <span style={sidebarStyles.bottomVal}>May 2 2026</span>
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
