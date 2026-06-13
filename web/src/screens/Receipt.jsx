export default function Receipt({ run }) {
  const events = run.events.filter(e => e.state === 'done' || e.state === 'keep' || e.state === 'drop' || e.state === 'warn');

  function exportJson() {
    const blob = new Blob([JSON.stringify(run.receipt || buildLite(run), null, 2)], { type: 'application/json' });
    download(blob, `hatch-receipt-${run.index || 'run'}.json`);
  }
  function exportMd() {
    download(new Blob([toMarkdown(run)], { type: 'text/markdown' }), `hatch-receipt-${run.index || 'run'}.md`);
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Receipt — the live, judge-verifiable proof</h1>
        <p>Every SPL that ran and the real hit-count it pulled back — different on every file, because it's your data and there's no template to fall back on.</p>
      </div>

      <div className="row-between" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Stat label="index" value={run.index} mono />
          <Stat label="proposed" value={run.proposed || (run.verified.length + run.dropped.length)} mono />
          <Stat label="verified" value={run.verified.length} mono teal />
          <Stat label="dropped" value={run.dropped.length} mono grey />
          <Stat label="brain" value={run.brain || '—'} />
          <Stat label="channel" value={run.actSurface === 'mcp-7931' ? 'MCP Server' : '443 REST'} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={exportMd}>Export .md</button>
          <button className="btn btn-amber" onClick={exportJson}>Export receipt</button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">The hatch log — sampled → proposed → verified → dropped → shipped</div>
        <div className="raw-block" style={{ maxHeight: 600 }}>
          {events.map((e, i) => (
            <div key={i}>
              <span className="ln">{ts(e.at)}</span>
              <strong style={{ color: e.state === 'drop' ? 'var(--grey)' : e.state === 'keep' ? 'var(--teal)' : 'var(--ink)' }}>{(e.phase || '').padEnd(9)}</strong>
              {' '}{e.msg}
              {e.hits != null ? `  [${e.hits}/${e.total}]` : ''}
              {e.ms != null ? `  ${(e.ms / 1000).toFixed(2)}s` : ''}
              {e.spl ? `\n            ${e.spl}` : ''}
            </div>
          ))}
        </div>
      </div>

      {run.dashboard?.url && (
        <div className="card">
          <div className="card-h">Persisted in your own Splunk Cloud</div>
          <div className="set-row"><span className="set-label">Dashboard</span><a className="set-val" href={run.dashboard.url} target="_blank" rel="noreferrer">{run.dashboard.url}</a></div>
          <div className="set-row"><span className="set-label">Baseline saved search</span><span className="set-val mono">{run.baseline?.name}</span></div>
          <div className="set-row"><span className="set-label">Uploaded events index</span><span className="set-val mono">{run.index}</span></div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono, teal, grey }) {
  return (
    <div>
      <div className={`${mono ? 'mono' : ''}`} style={{ fontSize: 20, fontWeight: 600, color: teal ? 'var(--teal)' : grey ? 'var(--grey)' : 'var(--ink)' }}>{value ?? '—'}</div>
      <div className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    </div>
  );
}
function ts(at) { if (!at) return '       '; const d = new Date(at); return d.toTimeString().slice(0, 8); }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function buildLite(run) {
  return { index: run.index, brain: run.brain, actSurface: run.actSurface, verified: run.verified, dropped: run.dropped, metrics: run.metrics, baseline: run.baseline, dashboard: run.dashboard };
}
function toMarkdown(run) {
  const r = run.receipt || buildLite(run);
  let md = `# Hatch receipt — ${r.index}\n\n`;
  md += `- brain: ${r.brain}\n- act-surface: ${r.actSurface}\n- dashboard: ${r.dashboard?.url || '(none)'}\n- baseline: ${r.baseline?.name || '(none)'}\n\n`;
  md += `## Verified fields\n\n`;
  for (const f of (r.verified || [])) md += `- **${f.field}** — verified ${f.hits}/${f.total} · \`${f.rex}\` · e.g. ${(f.sample || []).slice(0, 3).join(', ')}\n`;
  if ((r.dropped || []).length) { md += `\n## Dropped\n\n`; for (const d of r.dropped) md += `- ~~${d.field}~~ — ${d.hits}/${d.total} · ${d.reason || 'returned on 0'}\n`; }
  return md;
}
