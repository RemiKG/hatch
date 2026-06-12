export default function Sample({ run }) {
  const { sample, profile, index, events } = run;
  const ingesting = run.events.some(e => e.phase === 'ingest') && !sample.count;
  const lastIngest = [...run.events].reverse().find(e => e.phase === 'ingest');

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Sample — what's actually in there</h1>
        <p>It reads your actual raw events first — not a spec, not a guess. <span className="mono">| head {run.sample.count || 500}</span> · <span className="mono">| fieldsummary</span> · <span className="mono">| stats</span>, all run live.</p>
      </div>

      <div className="row-between" style={{ marginBottom: 16 }}>
        <span className="pill">
          <span className="dot-live" style={{ background: 'var(--teal)' }} />
          <span className="mono">index={index || '…'}</span> · <span className="mono">{sample.count || 0} events</span> · measured
        </span>
        {sample.ms > 0 && <span className="pill"><span className="mono">{(sample.ms / 1000).toFixed(2)}s</span> sample</span>}
      </div>

      {ingesting && (
        <div className="card"><div className="muted">{lastIngest?.msg || 'ingesting your log into a fresh index…'}</div></div>
      )}

      <div className="split">
        <div className="card">
          <div className="card-h">The raw events — your bytes, read live</div>
          <div className="raw-block">
            {sample.raw.length === 0 && <span className="muted">reading the egg…</span>}
            {sample.raw.slice(0, 200).map((line, i) => (
              <div key={i}><span className="ln">{String(i + 1).padStart(3, ' ')}</span>{line}</div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h">fieldsummary profile · {profile.length} candidate columns</div>
          {profile.length === 0 ? <div className="muted">profiling…</div> : (
            <table className="profile">
              <thead><tr><th>column</th><th>cardinality</th><th>fill</th><th>type</th></tr></thead>
              <tbody>
                {profile.slice(0, 45).map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.field}</td>
                    <td className="mono">{p.cardinality}</td>
                    <td className="mono">{p.fillPct}%</td>
                    <td><span className={`tag ${p.type === 'numeric' ? 'amber' : 'grey'}`}>{p.type}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">The SPL that ran — verbatim, auditable</div>
        <div className="raw-block" style={{ maxHeight: 120 }}>
          search index={index || '<egg>'} | head {sample.count || 500} | table _raw{'\n'}
          search index={index || '<egg>'} | head {sample.count || 500} | fieldsummary
        </div>
      </div>
    </div>
  );
}
