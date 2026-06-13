export default function Dashboard({ run }) {
  const d = run.dashboard;
  const metrics = run.metrics || [];

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Dashboard — the egg is a bird</h1>
        <p>Two minutes ago this index had no fields and no dashboard. Now it has both — POSTed as a real Dashboard Studio app, clickable in your own Splunk.</p>
      </div>

      {!d ? <div className="card"><div className="muted">shipping the dashboard…</div></div> : (
        <>
          <div className="card" style={{ borderColor: 'var(--teal)', borderWidth: 1.5 }}>
            <div className="row-between">
              <div style={{ minWidth: 0 }}>
                <div className="card-h" style={{ marginBottom: 6 }}>Shipped Dashboard Studio app</div>
                <a href={d.url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 14.5, wordBreak: 'break-all' }}>{d.url || d.error}</a>
              </div>
              {d.url && (
                <a className="btn btn-ink" href={d.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                  Open in Splunk
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7m0 0H9m8 0v8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </a>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h">Panels — your real numbers, computed live</div>
            <div className="split">
              {metrics.map((m, i) => (
                <PanelPreview key={i} metric={m} index={run.index} />
              ))}
            </div>
          </div>

          {d.url && (
            <div className="card">
              <div className="card-h">Open it in Splunk</div>
              <p className="muted" style={{ marginTop: 0 }}>
                Splunk Cloud sets <span className="mono">X-Frame-Options</span>, so it won't render inside another page — that's Splunk's security, not a mock. The dashboard is a real saved Dashboard Studio view in your own stack; open it in a new tab to see the panels render live with your data.
              </p>
              <a className="btn btn-amber" href={d.url} target="_blank" rel="noreferrer">
                Open the live dashboard in Splunk
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M7 17L17 7m0 0H9m8 0v8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PanelPreview({ metric, index }) {
  const raw = metric.sampleRows || [];
  // hide timechart metadata columns and prefer rows that carry a value
  const SKIP = /^_span$|^_raw$/;
  const rows = raw.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !SKIP.test(k)))).slice(0, 5);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <div className="card" style={{ boxShadow: 'none', background: 'var(--cream-warm)' }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>{metric.title || metric.field}</strong>
        <span className={`tag ${metric.live ? 'teal' : 'grey'}`}>{metric.live ? 'live' : 'n/a'}</span>
      </div>
      {rows.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>{metric.error || 'computing…'}</div> : (
        <table className="profile" style={{ fontSize: 12.5 }}>
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 4).map((r, i) => (
              <tr key={i}>{cols.map(c => <td key={c} className="mono">{String(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
