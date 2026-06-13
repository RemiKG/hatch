import { useEffect, useMemo, useState } from 'react';
import { Wordmark } from './components/Brand.jsx';
import { getHealth, startHatch, streamHatch, getReceipt } from './lib/api.js';
import Point from './screens/Point.jsx';
import Sample from './screens/Sample.jsx';
import Hatch from './screens/Hatch.jsx';
import Fields from './screens/Fields.jsx';
import Baseline from './screens/Baseline.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Receipt from './screens/Receipt.jsx';
import Settings from './screens/Settings.jsx';

const NAV = [
  { id: 'point', label: 'Point', n: '01' },
  { id: 'sample', label: 'Sample', n: '02' },
  { id: 'hatch', label: 'Hatch', n: '03' },
  { id: 'fields', label: 'Fields', n: '04' },
  { id: 'baseline', label: 'Baseline', n: '05' },
  { id: 'dashboard', label: 'Dashboard', n: '06' },
  { id: 'receipt', label: 'Receipt', n: '07' },
  { id: 'settings', label: 'Settings', n: '08' },
];

// Reduce the live event stream into the shape every screen reads from.
function emptyRun() {
  return {
    id: null, demoEgg: false, running: false, done: false, error: null,
    index: null, actSurface: null, brain: null,
    events: [],
    sample: { raw: [], count: 0, ms: 0 },
    profile: [],
    proposed: 0,
    verified: [],   // {field, rex, why, hits, total, sample, partial}
    dropped: [],    // {field, rex, hits, total, reason}
    metrics: [],
    baseline: null,
    dashboard: null,
    receipt: null,
  };
}

function reduceEvent(run, ev) {
  const r = { ...run, events: [...run.events, ev] };
  switch (ev.phase) {
    case 'point': if (ev.index) r.index = ev.index; if (ev.demoEgg != null) r.demoEgg = ev.demoEgg; break;
    case 'connect': if (ev.actSurface) r.actSurface = ev.actSurface; break;
    case 'sample':
      if (ev.state === 'done') r.sample = { raw: ev.raw || r.sample.raw, count: ev.count ?? r.sample.count, ms: ev.ms ?? r.sample.ms };
      break;
    case 'profile': if (ev.state === 'done' && ev.profile) r.profile = ev.profile; break;
    case 'propose':
      if (ev.state === 'done') { r.proposed = ev.count ?? r.proposed; r.brain = inferBrain(ev.msg) || r.brain; }
      break;
    case 'verify':
      if (ev.state === 'keep') r.verified = upsert(r.verified, ev);
      else if (ev.state === 'drop') r.dropped = upsert(r.dropped, { ...ev, reason: dropReason(ev.msg) });
      break;
    case 'metrics': if (ev.state === 'done' && ev.metrics) r.metrics = ev.metrics; break;
    case 'baseline': if (ev.state === 'done' && ev.baseline) r.baseline = ev.baseline; break;
    case 'dashboard': if (ev.state === 'done' && ev.dashboard) r.dashboard = ev.dashboard; break;
    case 'error': r.error = ev.msg; r.running = false; break;
    default: break;
  }
  return r;
}
function inferBrain(msg = '') { const m = msg.match(/\((gemini|heuristic)\)/); return m ? m[1] : null; }
function dropReason(msg = '') { const i = msg.indexOf('— '); return i >= 0 ? msg.slice(i + 2) : msg; }
function upsert(arr, ev) {
  const i = arr.findIndex(x => x.field === ev.field);
  const item = { field: ev.field, rex: ev.rex, why: ev.why, hits: ev.hits, total: ev.total, sample: ev.sample, partial: ev.partial, reason: ev.reason };
  if (i >= 0) { const copy = [...arr]; copy[i] = { ...copy[i], ...item }; return copy; }
  return [...arr, item];
}

export default function App() {
  const [screen, setScreen] = useState('point');
  const [run, setRun] = useState(emptyRun());
  const [health, setHealth] = useState(null);
  const [settings, setSettings] = useState({
    sampleSize: 500, maxProposals: 8, previewRows: 5,
    partialWarn: 450, heuristicFallback: true, cron: '*/15 * * * *',
  });

  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth({ ok: false })); }, []);

  async function launch({ mode, text, filename, index }) {
    const fresh = emptyRun();
    fresh.running = true;
    fresh.demoEgg = mode === 'demo';
    setRun(fresh);
    setScreen(mode === 'index' ? 'hatch' : 'sample');
    const res = await startHatch({ mode, text, filename, index, options: settings });
    if (!res.ok) { setRun(r => ({ ...r, running: false, error: res.error || 'failed to start' })); return; }
    setRun(r => ({ ...r, id: res.runId, demoEgg: res.demoEgg }));
    // advance to the hatch rail once sampling completes
    let movedToHatch = false;
    streamHatch(res.runId, (ev) => {
      setRun(prev => reduceEvent(prev, ev));
      if (!movedToHatch && ev.phase === 'profile' && ev.state === 'done') { movedToHatch = true; setScreen('hatch'); }
      if (ev.phase === 'dashboard' && ev.state === 'done' && ev.dashboard?.url) setScreen('dashboard');
    }, async () => {
      const full = await getReceipt(res.runId);
      // Re-derive the whole run from the server's authoritative event log. The live SSE stream can miss an
      // early event (a late EventSource subscription, a dropped frame), which would leave a derived screen
      // like Sample/Fields empty even though the data was computed. Replaying every event through the same
      // reducer guarantees every screen shows the real, populated state once the run is done.
      setRun(prev => {
        let next = (full.events && full.events.length)
          ? full.events.reduce(reduceEvent, { ...emptyRun(), id: prev.id, demoEgg: prev.demoEgg })
          : prev;
        return { ...next, running: false, done: true, receipt: full.receipt };
      });
    });
  }

  const props = { run, health, settings, setSettings, setScreen, launch, demoEgg: run.demoEgg };
  const screenEl = useMemo(() => {
    switch (screen) {
      case 'point': return <Point {...props} />;
      case 'sample': return <Sample {...props} />;
      case 'hatch': return <Hatch {...props} />;
      case 'fields': return <Fields {...props} />;
      case 'baseline': return <Baseline {...props} />;
      case 'dashboard': return <Dashboard {...props} />;
      case 'receipt': return <Receipt {...props} />;
      case 'settings': return <Settings {...props} />;
      default: return <Point {...props} />;
    }
  }, [screen, run, health, settings]);

  const hasRun = !!run.id || run.running;

  return (
    <div className="app">
      {run.demoEgg && <div className="demo-stamp">DEMO EGG</div>}
      <nav className="nav">
        <Wordmark />
        {NAV.map(item => {
          const locked = !hasRun && !['point', 'settings'].includes(item.id);
          return (
            <button key={item.id} className={`nav-item ${screen === item.id ? 'active' : ''}`}
              disabled={locked} onClick={() => setScreen(item.id)}>
              <span className="nav-num">{item.n}</span>{item.label}
            </button>
          );
        })}
        <div className="nav-foot">
          From bytes to a dashboard<br />before the coffee's done.
          <div style={{ marginTop: 10 }} className="mono">
            {health?.splunk?.connected ? '● splunk connected' : '○ splunk offline'}<br />
            {health?.agent?.available ? '● gemini · vertex' : '○ heuristic mode'}
          </div>
        </div>
      </nav>
      <main className="main">{screenEl}</main>
    </div>
  );
}
