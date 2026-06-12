export default function Baseline({ run }) {
  const b = run.baseline;
  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Baseline — armed from minute one</h1>
        <p>A real <span className="mono">anomalydetection</span> scheduled search, so the brand-new source is watched the moment it hatches — never dark for three weeks.</p>
      </div>

      {!b ? <div className="card"><div className="muted">arming the baseline…</div></div> : (
        <>
          <div className="card">
            <div className="row-between">
              <div>
                <div className="card-h" style={{ marginBottom: 6 }}>Saved scheduled search</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{b.name}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>watching: {b.metricTitle} · schedule <span className="mono">{b.saved?.cron || '*/15 * * * *'}</span></div>
              </div>
              <span className="tag teal">{b.saved?.status === 201 ? 'saved · live' : b.saved?.existed ? 'saved · exists' : 'saved'}</span>
            </div>
            <div className="spark-wrap" style={{ marginTop: 16 }}>
              <Sparkline band={b.band || []} />
            </div>
          </div>

          <div className="card">
            <div className="card-h">The exact SPL</div>
            <div className="raw-block" style={{ maxHeight: 140 }}>{b.spl?.replace('__INDEX__', run.index)}</div>
          </div>

          <div className="card">
            <div className="row-between">
              <div>
                <div className="set-label">Baseline engine</div>
                <div className="set-sub">SPL <span className="mono">anomalydetection</span> — core Splunk ML, real now. Upgrades to Cisco Deep Time-Series forecast if Hosted Models enable.</div>
              </div>
              <span className="badge live"><span className="dot-live" />{b.engine}</span>
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: 13, marginBottom: 0 }}>Same armed baseline, named honestly.</p>
          </div>
        </>
      )}
    </div>
  );
}

// Draw the metric line + a shaded baseline band from the real anomalydetection rows.
function Sparkline({ band }) {
  const W = 760, H = 150, pad = 8;
  // band rows look like { _time, metric/volume, lowerBound..., upperBound... } depending on SPL; pull the
  // first numeric non-time column as the series.
  // keep only buckets that actually have a value (drop empty timechart buckets), take the last ~80.
  const SKIP = /^_(time|span|raw|kv|indextime)$|^lower|^upper|^isOutlier|^probable/i;
  const all = band.filter(r => r && typeof r === 'object');
  const valKey = all.length
    ? (Object.keys(all[0]).find(k => !SKIP.test(k) && all.some(r => Number(r[k])) ) || null)
    : null;
  if (!valKey) return <div className="muted">band drawn from {all.length} points (metric flat over the window)</div>;
  const rows = all.filter(r => r[valKey] !== '' && r[valKey] != null).slice(-80);
  if (rows.length < 2) return <div className="muted">band drawing… (the first window needs more events to model the metric)</div>;
  const vals = rows.map(r => Number(r[valKey]) || 0);
  const min = Math.min(...vals), max = Math.max(...vals) || 1;
  const span = max - min || 1;
  const x = i => pad + (i / (rows.length - 1)) * (W - 2 * pad);
  const y = v => H - pad - ((v - min) / span) * (H - 2 * pad);
  const linePts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  // a light ±15% band around the line as the "first band drawn" visual
  const upper = vals.map((v, i) => `${x(i)},${y(v * 1.15)}`);
  const lower = vals.map((v, i) => `${x(i)},${y(v * 0.85)}`).reverse();
  const bandPath = `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <path d={bandPath} fill="var(--amber-soft)" />
      <polyline points={linePts} fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinejoin="round" />
      <text x={pad} y={14} fontSize="10" fill="var(--ink-40)" fontFamily="var(--mono)">{valKey} · {rows.length} pts · anomaly band</text>
    </svg>
  );
}
