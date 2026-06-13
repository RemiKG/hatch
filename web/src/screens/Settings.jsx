export default function Settings({ health, settings, setSettings }) {
  const h = health || {};
  const s = settings;
  const set = (k, v) => setSettings(p => ({ ...p, [k]: v }));

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Settings</h1>
        <p>The full engine — Hatch shows exactly what the token can and can't do, and which channel is live.</p>
      </div>

      <div className="card">
        <div className="card-h">Connection</div>
        <Row label="Splunk Cloud host" value={h.splunk?.url || '—'} mono />
        <Row label="443-proxy session" badge={h.splunk?.connected ? 'live' : 'off'} badgeText={h.splunk?.connected ? 'connected' : 'offline'} />
        <Row label="Account scope" value={h.splunk?.username ? `${h.splunk.username} · ${(h.splunk.roles || []).join(', ')}` : '—'} mono />
        <Row label="Can POST dashboards" badge={h.splunk?.canPostDashboards ? 'live' : 'off'} badgeText={h.splunk?.canPostDashboards ? 'yes' : 'no'} />
      </div>

      <div className="card">
        <div className="card-h">Act surface</div>
        <Row label="MCP Server (app 7931, /services/mcp)" sub="Hatch prefers MCP as its act-surface (target bonus); else identical steps over 443-direct."
          badge={h.mcp ? 'live' : 'off'} badgeText={h.mcp ? 'MCP live' : 'not installed → 443 REST'} />
        <Row label="Active channel" value={h.actSurface === 'mcp-7931' ? 'MCP Server (app 7931)' : 'direct 443 REST proxy'} mono />
      </div>

      <div className="card">
        <div className="card-h">Agent (the reasoning brain)</div>
        <Row label="Provider" value="Gemini · Vertex AI" />
        <Row label="Project / location" value={`${h.agent?.project || 'rapid-agents-5166'} · ${h.agent?.location || 'global'}`} mono />
        <Row label="Model" value={h.agent?.model || 'gemini-flash-latest'} mono />
        <Row label="Status" badge={h.agent?.available ? 'live' : 'off'} badgeText={h.agent?.available ? 'available' : 'heuristic fallback'} />
        <ToggleRow label="Heuristic-extractor fallback" sub="Used if Vertex unreachable — the verify-by-execution gate is unchanged, so the proof never depends on the LLM."
          on={s.heuristicFallback} onClick={() => set('heuristicFallback', !s.heuristicFallback)} />
      </div>

      <div className="card">
        <div className="card-h">Sampling & verify gate</div>
        <NumRow label="Sample size" sub="default 500" value={s.sampleSize} min={100} max={2000} step={100} onChange={v => set('sampleSize', v)} />
        <NumRow label="Max extraction proposals" sub="default 8" value={s.maxProposals} min={3} max={15} step={1} onChange={v => set('maxProposals', v)} />
        <NumRow label="Values-preview rows" sub="count + values, never count alone" value={s.previewRows} min={1} max={12} step={1} onChange={v => set('previewRows', v)} />
        <Row label="Keep threshold" value="> 0 / sample" mono />
        <NumRow label="Partial-hit warn under" sub="flag for split-per-format" value={s.partialWarn} min={0} max={2000} step={50} onChange={v => set('partialWarn', v)} />
      </div>

      <div className="card">
        <div className="card-h">Baseline & Hosted Models</div>
        <Row label="Baseline engine" value="SPL anomalydetection (floor)" mono />
        <Row label="Schedule (cron)" value={s.cron} mono />
        <Row label="Hosted Models (Cisco Deep Time-Series / Foundation-sec)" sub={h.hostedModels?.note || 'not enabled → SPL fallback'}
          badge={h.hostedModels?.enabled ? 'live' : 'off'} badgeText={h.hostedModels?.enabled ? 'enabled' : 'SPL fallback'} />
      </div>
    </div>
  );
}

function Row({ label, sub, value, mono, badge, badgeText }) {
  return (
    <div className="set-row">
      <div><div className="set-label">{label}</div>{sub && <div className="set-sub">{sub}</div>}</div>
      {badge ? <span className={`badge ${badge}`}><span className="dot-live" />{badgeText}</span> : <span className={`set-val ${mono ? 'mono' : ''}`}>{value}</span>}
    </div>
  );
}
function ToggleRow({ label, sub, on, onClick }) {
  return (
    <div className="set-row">
      <div><div className="set-label">{label}</div>{sub && <div className="set-sub">{sub}</div>}</div>
      <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick}><i /></button>
    </div>
  );
}
function NumRow({ label, sub, value, min, max, step, onChange }) {
  return (
    <div className="set-row">
      <div><div className="set-label">{label}</div>{sub && <div className="set-sub">{sub}</div>}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
        <span className="set-val mono" style={{ width: 48 }}>{value}</span>
      </div>
    </div>
  );
}
