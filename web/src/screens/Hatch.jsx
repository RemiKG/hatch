// THE MONEY-SHOT screen: the single live hatch rail. Proposals stream in, each one runs against the real
// events, and lands a verdict — teal verified or grey dropped — with its real returned-on-N/total count.
export default function Hatch({ run, setScreen }) {
  const { proposed, verified, dropped } = run;
  const phaseEvents = run.events.filter(e =>
    ['point', 'ingest', 'connect', 'sample', 'profile', 'propose', 'metrics', 'baseline', 'dashboard', 'complete'].includes(e.phase)
    && e.state === 'done'
  );

  // Build the ordered rail: phase milestones interleaved with verify verdicts, in event order.
  const rail = [];
  for (const e of run.events) {
    if (e.phase === 'verify' && (e.state === 'keep' || e.state === 'drop')) {
      rail.push({ kind: e.state, ...e });
    } else if (['sample', 'profile', 'propose', 'metrics', 'baseline', 'dashboard', 'connect', 'complete'].includes(e.phase) && (e.state === 'done' || e.state === 'warn')) {
      rail.push({ kind: 'phase', warn: e.state === 'warn', ...e });
    }
  }

  const total = proposed || (verified.length + dropped.length) || 0;
  const settled = verified.length + dropped.length;
  const pct = run.done ? 100 : total ? Math.min(95, Math.round((settled / total) * 80) + (run.profile.length ? 15 : 0)) : (run.sample.count ? 15 : 5);

  const running = [...run.events].reverse().find(e => e.phase === 'verify' && e.state === 'run');
  const runningField = !run.done && running && !rail.some(r => r.field === running.field && (r.kind === 'keep' || r.kind === 'drop')) ? running : null;

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Hatch — watch the egg crack</h1>
        <p>It proposes the fields a human would hand-write — then proves each one by running it. No fake field survives.</p>
      </div>

      <div className="rail-head">
        <div className="rail-counter"><span className="n amber mono">{total || '—'}</span><span className="l">proposed</span></div>
        <div className="rail-counter"><span className="n teal mono">{verified.length}</span><span className="l">verified</span></div>
        <div className="rail-counter"><span className="n grey mono">{dropped.length}</span><span className="l">dropped</span></div>
        <div style={{ marginLeft: 'auto' }}>
          {run.brain && <span className="tag amber">brain · {run.brain}</span>}{' '}
          <span className="tag grey">{run.actSurface === 'mcp-7931' ? 'MCP Server' : '443 REST'}</span>
        </div>
      </div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>

      <div className="card">
        <div className="timeline">
          {rail.length === 0 && <div className="muted" style={{ paddingLeft: 4 }}>sampling the egg…</div>}
          {rail.map((r, i) => r.kind === 'phase' ? (
            <PhaseStep key={i} ev={r} />
          ) : (
            <VerifyStep key={i} ev={r} />
          ))}
          {runningField && <VerifyStep ev={{ ...runningField, kind: 'run' }} live />}
        </div>
      </div>

      {run.done && (
        <div className="row-between" style={{ marginTop: 22 }}>
          <p className="muted" style={{ margin: 0 }}>The egg is a bird. Every field above was proven on your real events.</p>
          <button className="btn btn-amber" onClick={() => setScreen('dashboard')}>See the dashboard →</button>
        </div>
      )}
    </div>
  );
}

function PhaseStep({ ev }) {
  return (
    <div className={`tl-step tl-phase ${ev.warn ? 'warn' : ''}`}>
      <div className="tl-node keep"><span className="dot" /></div>
      <div className="tl-main">
        <div className="tl-field">{ev.msg}</div>
        {ev.spl && <div className="tl-spl">{ev.spl}</div>}
        {ev.ms != null && <div className="tl-ms">{(ev.ms / 1000).toFixed(2)}s</div>}
      </div>
    </div>
  );
}

function VerifyStep({ ev, live }) {
  const kept = ev.kind === 'keep';
  const dropped = ev.kind === 'drop';
  return (
    <div className="tl-step">
      <div className={`tl-node ${live ? 'run' : kept ? 'keep' : 'drop'}`}><span className="dot" /></div>
      <div className="tl-row">
        <div className="tl-main">
          <div className={`tl-field ${dropped ? 'dropped' : ''}`}>{ev.field}</div>
          <div className="tl-rex">{ev.rex}</div>
          {ev.why && !dropped && <div className="tl-why">{ev.why}</div>}
        </div>
        <div className="tl-verdict">
          {live ? <span className="tag amber">running…</span>
            : kept ? <span className={`tag teal`}>verified — {ev.hits}/{ev.total}{ev.partial ? ' · partial' : ''}</span>
            : <span className="tag grey">dropped — {ev.hits}/{ev.total}</span>}
          {ev.ms != null && !live && <div className="tl-ms">{ev.ms}ms</div>}
          {dropped && <div className="tl-ms" style={{ color: 'var(--grey)' }}>no template to fall back on</div>}
        </div>
      </div>
    </div>
  );
}
