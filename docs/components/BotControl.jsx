
function BotControl({ data, botStatus, setBotStatus }) {
  const { account, position, bot_state, config, last_signal } = data;
  const [lossStreak, setLossStreak] = React.useState(bot_state.loss_streak);
  const [tierRestricted, setTierRestricted] = React.useState(bot_state.tier_restricted);
  const [lastAction, setLastAction] = React.useState(null);
  const [nextScan, setNextScan] = React.useState('—');

  // Dynamic risk amounts based on live equity
  const equity = account.equity || account.account_size;
  const tierMaxRisk = t => (config.TIER_RISK_PCT[t] / 100 * equity);

  // Countdown to next scan
  React.useEffect(() => {
    const compute = () => {
      const lastStr = bot_state.last_daily_scan_day;
      if (!lastStr) { setNextScan('—'); return; }
      const last = new Date(lastStr.replace(' ', 'T') + ':00Z');
      const diffMs = (last.getTime() + 15 * 60 * 1000) - Date.now();
      if (diffMs <= 0) { setNextScan('Any moment'); return; }
      const m = Math.floor(diffMs / 60000);
      const s = Math.floor((diffMs % 60000) / 1000);
      setNextScan(`${m}m ${s}s`);
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [bot_state.last_daily_scan_day]);

  const log = msg => setLastAction({ msg, ts: new Date().toLocaleTimeString() });

  const handleStart = () => { setBotStatus('running'); log('Bot started — scanning H4 bars every 15 min'); };
  const handlePause = () => { setBotStatus('paused');  log('Bot paused — open position maintained, no new entries'); };
  const handleStop  = () => { setBotStatus('stopped'); log('Bot stopped'); };

  const simulateLoss = () => {
    const next = lossStreak + 1;
    setLossStreak(next);
    if (next >= 3) { setTierRestricted(true); log('⚠️ Loss streak 3 — T1 only. Max risk drops to ' + config.TIER_RISK_PCT[1] + '% of equity.'); }
    else log(`Loss recorded. Streak: ${next}/3`);
  };
  const simulateWin = () => {
    setLossStreak(0); setTierRestricted(false);
    log('Win recorded. Loss streak reset. All tiers unlocked.');
  };

  const statusColor = botStatus === 'running' ? '#00d084' : botStatus === 'paused' ? '#F7931A' : '#ff4d6d';

  return (
    <div style={bcStyles.wrap}>
      <div style={bcStyles.pageTitle}>Bot Control</div>

      <div style={bcStyles.grid}>
        {/* Status */}
        <div style={bcStyles.card}>
          <div style={bcStyles.cardTitle}>System Status</div>
          <div style={bcStyles.statusBig}>
            <div style={{...bcStyles.orb, background:statusColor, boxShadow:`0 0 18px ${statusColor}55`}}></div>
            <div>
              <div style={{fontSize:18, fontWeight:700, color:statusColor, fontFamily:"'JetBrains Mono',monospace", letterSpacing:'1px'}}>{botStatus.toUpperCase()}</div>
              <div style={{fontSize:11, color:'#5a5a6e', marginTop:3}}>BTC/USD · {config.PRIMARY_TF.toUpperCase()} · every {config.RUN_INTERVAL_MINUTES}min</div>
            </div>
          </div>
          <div style={bcStyles.infoGrid}>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Exchange</span><span style={{...bcStyles.val, color:'#00d084'}}>● Connected</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Data feed</span><span style={{...bcStyles.val, color:'#5a5a6e'}}>Coinbase (public)</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Telegram</span><span style={{...bcStyles.val, color:'#00d084'}}>Active ✓</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Morning brief</span><span style={bcStyles.val}>{config.MORNING_BRIEF_LOCAL} UTC</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Last scan</span><span style={bcStyles.val}>{bot_state.last_daily_scan_day || '—'}</span></div>
            <div style={bcStyles.row}>
              <span style={bcStyles.lbl}>Next scan in</span>
              <span style={{...bcStyles.val, color: nextScan === 'Any moment' ? '#F7931A' : '#ece9e2'}}>{nextScan}</span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={bcStyles.card}>
          <div style={bcStyles.cardTitle}>Controls</div>
          <div style={bcStyles.ctrlGrid}>
            <button onClick={handleStart} disabled={botStatus==='running'}
              style={{...bcStyles.btn, background:'rgba(0,208,132,0.12)', color:'#00d084', border:'1px solid rgba(0,208,132,0.25)', opacity:botStatus==='running'?0.3:1}}>▶ Start</button>
            <button onClick={handlePause} disabled={botStatus!=='running'}
              style={{...bcStyles.btn, background:'rgba(247,147,26,0.12)', color:'#F7931A', border:'1px solid rgba(247,147,26,0.25)', opacity:botStatus!=='running'?0.3:1}}>⏸ Pause</button>
            <button onClick={handleStop} disabled={botStatus==='stopped'}
              style={{...bcStyles.btn, background:'rgba(90,90,110,0.1)', color:'#5a5a6e', border:'1px solid #1f1f28', opacity:botStatus==='stopped'?0.3:1}}>■ Stop</button>
          </div>
          {lastAction && (
            <div style={bcStyles.logMsg}>
              <span style={{color:'#F7931A'}}>●</span> {lastAction.msg}
              <span style={{color:'#3e3e52', marginLeft:8}}>{lastAction.ts}</span>
            </div>
          )}
          <div style={{marginTop:16, paddingTop:14, borderTop:'1px solid #1a1a22'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
              <div style={{fontSize:11, color:'#3e3e52', letterSpacing:'0.5px', textTransform:'uppercase'}}>Test Scenarios</div>
              <div style={{fontSize:10, color:'#2a2a38', fontStyle:'italic'}}>visual only — does not affect live bot</div>
            </div>
            <div style={{display:'flex', gap:8}}>
              <button onClick={simulateLoss} style={{...bcStyles.btn, flex:1, background:'rgba(255,77,109,0.1)', color:'#ff4d6d', border:'1px solid rgba(255,77,109,0.2)', padding:'9px'}}>Simulate Loss</button>
              <button onClick={simulateWin}  style={{...bcStyles.btn, flex:1, background:'rgba(0,208,132,0.1)', color:'#00d084', border:'1px solid rgba(0,208,132,0.2)', padding:'9px'}}>Simulate Win</button>
            </div>
          </div>
        </div>

        {/* Protection Rules */}
        <div style={bcStyles.card}>
          <div style={bcStyles.cardTitle}>Protection Rules</div>

          {/* Loss streak */}
          <div style={{marginBottom:16}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
              <span style={bcStyles.lbl}>Consecutive Losses</span>
              <span style={{fontSize:12, color: lossStreak >= 3 ? '#ff4d6d' : lossStreak >= 2 ? '#F7931A' : '#5a5a6e', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{lossStreak} / 3</span>
            </div>
            <div style={{display:'flex', gap:5}}>{[1,2,3].map(n => (
              <div key={n} style={{flex:1, height:8, borderRadius:3, background: n <= lossStreak ? (lossStreak>=3?'#ff4d6d':'#F7931A') : '#1f1f28', transition:'background 0.3s'}}></div>
            ))}</div>
            <div style={{fontSize:11, color:'#3e3e52', marginTop:5}}>At 3 losses in a row → only highest-confidence setups allowed</div>
          </div>

          <div style={bcStyles.infoGrid}>
            <div style={bcStyles.row}>
              <span style={bcStyles.lbl}>Streak Lock</span>
              <span style={{...bcStyles.val, color: tierRestricted ? '#ff4d6d':'#00d084'}}>
                {tierRestricted ? '⚠ Active — T1 only' : '✓ Off — All setups open'}
              </span>
            </div>

            {/* DD Filter */}
            <div style={bcStyles.row}>
              <span style={bcStyles.lbl}>Portfolio Drawdown</span>
              <span style={{...bcStyles.val, color: bot_state.portfolio_dd_pct <= -10 ? '#ff4d6d' : bot_state.portfolio_dd_pct <= -5 ? '#F7931A' : '#5a5a6e'}}>
                {bot_state.portfolio_dd_pct?.toFixed(1) ?? '0.0'}%
                <span style={{fontSize:10, color:'#3e3e52', fontWeight:400}}> / {config.DD_FILTER_PCT}% limit</span>
              </span>
            </div>
            <div style={bcStyles.row}>
              <span style={bcStyles.lbl}>T3 DD Pause</span>
              <span style={{...bcStyles.val, color: bot_state.tier3_paused ? '#ff4d6d' : '#00d084'}}>
                {bot_state.tier3_paused ? '⚠ Paused — DD limit hit' : '✓ Active'}
              </span>
            </div>

            <div style={bcStyles.row}><span style={bcStyles.lbl}>Trade Pending</span><span style={{...bcStyles.val, color: bot_state.trade_pending?'#F7931A':'#5a5a6e'}}>{bot_state.trade_pending ? 'Awaiting fill':'None'}</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Last Signal Bar</span><span style={{...bcStyles.val, fontSize:11}}>{bot_state.last_signal_bar?.slice(0,16).replace('T',' ') || '—'}</span></div>
          </div>
        </div>

        {/* Active trade */}
        <div style={bcStyles.card}>
          <div style={bcStyles.cardTitle}>Active Trade</div>
          {bot_state.active_trade ? (
            <>
              <div style={{display:'flex', gap:8, marginBottom:14, alignItems:'center'}}>
                <span style={{fontSize:13, fontWeight:700, color:'#00d084'}}>LONG</span>
                <GradeBadge grade={bot_state.active_trade.grade} />
                <TierBadge  tier={bot_state.active_trade.tier} />
                <span style={{fontSize:11, color:'#F7931A', fontFamily:"'JetBrains Mono',monospace"}}>{bot_state.active_trade.setup_type}</span>
              </div>
              <div style={bcStyles.infoGrid}>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>Entry</span><span style={bcStyles.val}>${bot_state.active_trade.entry_price.toLocaleString()}</span></div>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>Stop Loss</span><span style={{...bcStyles.val, color:'#ff4d6d'}}>${bot_state.active_trade.sl_price.toLocaleString()}</span></div>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>Take Profit</span><span style={{...bcStyles.val, color:'#00d084'}}>${bot_state.active_trade.tp_price.toLocaleString()}</span></div>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>R:R Target</span><span style={bcStyles.val}>1 : {bot_state.active_trade.rr_target}</span></div>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>Max Risk</span><span style={bcStyles.val}>${bot_state.active_trade.max_risk_usd}</span></div>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>Qty</span><span style={bcStyles.val}>{bot_state.active_trade.qty} BTC</span></div>
                <div style={bcStyles.row}><span style={bcStyles.lbl}>Unrealised PnL</span><span style={{...bcStyles.val, color:'#00d084'}}>+${position.unrealized_pl.toFixed(2)}</span></div>
              </div>
            </>
          ) : (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:110, gap:8}}>
              <span style={{fontSize:24, opacity:0.1}}>◫</span>
              <span style={{fontSize:13, color:'#3e3e52'}}>No active trade</span>
              <span style={{fontSize:11, color:'#2a2a38', textAlign:'center'}}>Watching for the next pattern signal</span>
            </div>
          )}
        </div>

        {/* Account */}
        <div style={bcStyles.card}>
          <div style={bcStyles.cardTitle}>Account</div>
          <div style={bcStyles.infoGrid}>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Equity</span><span style={{...bcStyles.val, color:'#F7931A'}}>${account.equity.toLocaleString()}</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Available</span><span style={bcStyles.val}>${account.buying_power.toFixed(2)}</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Starting Size</span><span style={bcStyles.val}>${account.account_size.toFixed(2)}</span></div>
            <div style={bcStyles.row}><span style={bcStyles.lbl}>Return</span><span style={{...bcStyles.val, color:'#00d084'}}>+{(((account.equity - account.account_size)/account.account_size)*100).toFixed(2)}%</span></div>
          </div>
        </div>

        {/* Tier risk config */}
        <div style={bcStyles.card}>
          <div style={bcStyles.cardTitle}>Risk Per Trade</div>
          {[
            { t:1, label:'High conviction setups', color:'#5a5a6e' },
            { t:2, label:'Medium conviction setups', color:'#a78bfa' },
            { t:3, label:'Speculative setups', color:'#F7931A' },
          ].map(({ t, label, color }) => {
            const pct  = config.TIER_RISK_PCT[t];
            const maxUsd = tierMaxRisk(t);
            const barW = (pct / config.TIER_RISK_PCT[1]) * 100; // T1=100%, T2~71%, T3~43%
            const blocked = tierRestricted && t > 1;
            return (
              <div key={t} style={{marginBottom:14}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4}}>
                  <div>
                    <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:2}}>
                      <TierBadge tier={t} />
                      <span style={{fontSize:11, color:'#5a5a6e'}}>needs R:R ≥ {config.TIER_RR[t]}×</span>
                    </div>
                    <div style={{fontSize:11, color:'#3e3e52'}}>{label}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color: blocked ? '#3e3e52' : '#ece9e2'}}>
                      {pct}%
                    </div>
                    <div style={{fontSize:11, color: blocked ? '#3e3e52' : '#5a5a6e'}}>
                      ${maxUsd.toFixed(0)} max
                    </div>
                  </div>
                </div>
                <div style={{height:4, background:'#1a1a22', borderRadius:2}}>
                  <div style={{width:`${barW}%`, height:'100%', background: blocked ? '#2a2a38' : color, borderRadius:2, transition:'all 0.3s'}}></div>
                </div>
                {blocked && <div style={{fontSize:10, color:'#ff4d6d', marginTop:3}}>⚠ Blocked by loss streak rule</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const bcStyles = {
  wrap: { padding:'28px 32px', height:'100%', overflowY:'auto', boxSizing:'border-box', fontFamily:"'Space Grotesk',sans-serif" },
  pageTitle: { fontSize:22, fontWeight:700, color:'#ece9e2', marginBottom:24, letterSpacing:'-0.5px' },
  grid: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 },
  card: { background:'#111116', border:'1px solid #1f1f28', borderRadius:10, padding:'20px 22px' },
  cardTitle: { fontSize:11, fontWeight:700, color:'#3e3e52', letterSpacing:'1px', textTransform:'uppercase', marginBottom:16 },
  statusBig: { display:'flex', gap:14, alignItems:'center', marginBottom:16 },
  orb: { width:12, height:12, borderRadius:'50%', flexShrink:0 },
  infoGrid: { display:'flex', flexDirection:'column', gap:9 },
  row: { display:'flex', justifyContent:'space-between', alignItems:'center' },
  lbl: { fontSize:12, color:'#3e3e52' },
  val: { fontSize:12, fontWeight:600, color:'#ece9e2', fontFamily:"'JetBrains Mono',monospace", textAlign:'right' },
  ctrlGrid: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:0 },
  btn: { padding:'11px 0', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:700, transition:'all 0.15s', fontFamily:"'Space Grotesk',sans-serif" },
  logMsg: { marginTop:12, fontSize:11, color:'#ece9e2', background:'#0d0d11', padding:'9px 12px', borderRadius:6, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.5 },
};

Object.assign(window, { BotControl });
