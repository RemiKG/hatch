import { useEffect, useRef, useState } from 'react';
import { getIndexes } from '../lib/api.js';

export default function Point({ launch, settings, setSettings, health }) {
  const [over, setOver] = useState(false);
  const [file, setFile] = useState(null);       // { name, text }
  const [indexes, setIndexes] = useState([]);
  const [selIdx, setSelIdx] = useState(null);
  const [demoEgg, setDemoEgg] = useState(false);
  const inputRef = useRef();

  useEffect(() => { getIndexes().then(r => { if (r.ok) setIndexes(r.indexes); }).catch(() => {}); }, []);

  async function readFile(f) {
    const text = await f.text();
    setFile({ name: f.name, text });
    setSelIdx(null); setDemoEgg(false);
  }
  function onDrop(e) {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  }
  function hatchIt() {
    if (demoEgg) return launch({ mode: 'demo' });
    if (file) return launch({ mode: 'upload', text: file.text, filename: file.name });
    if (selIdx) return launch({ mode: 'index', index: selIdx });
  }
  const ready = demoEgg || file || selIdx;
  const fresh = indexes.filter(i => i.events === 0 || (i.name.includes('hatch') ));

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Point Hatch at the egg.</h1>
        <p>Get back a dashboard. Every field verified, not guessed. — Drag a raw log here, or pick a fresh index. One input: <em>which egg?</em></p>
      </div>

      <div
        className={`drop-target ${over ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" hidden accept=".log,.txt,.json,.csv,.out,text/*"
          onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />
        <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.6">
          <path d="M12 16V4m0 0L8 8m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" />
        </svg>
        {file ? (
          <>
            <h3>{file.name}</h3>
            <p className="mono">{file.text.split(/\r?\n/).filter(l => l.trim()).length} lines ready to hatch</p>
          </>
        ) : (
          <>
            <h3>Drag a raw log here</h3>
            <p>…or click to choose a file — any oddball format. No template needed.</p>
          </>
        )}
      </div>

      <div className="row-between" style={{ marginTop: 22 }}>
        <button className="btn btn-amber" disabled={!ready} onClick={hatchIt}>
          Hatch it
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M5 12h14m-6-6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="set-row" style={{ border: 'none', padding: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="set-label">DEMO EGG</div>
            <div className="set-sub">A bundled, deliberately-messy multi-format log — for judges with no file handy.</div>
          </div>
          <button aria-label="Toggle demo egg" className={`toggle ${demoEgg ? 'on' : ''}`}
            onClick={() => { setDemoEgg(v => !v); setFile(null); setSelIdx(null); }}><i /></button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 26 }}>
        <div className="card-h">Live indexes · un-extracted sourcetypes flagged</div>
        {indexes.length === 0 && <div className="muted">Connecting to Splunk…</div>}
        {indexes.map(i => {
          const isFresh = i.events === 0;
          return (
            <div key={i.name} className={`idx-row ${selIdx === i.name ? 'sel' : ''}`}
              onClick={() => { setSelIdx(i.name); setFile(null); setDemoEgg(false); }}>
              <div>
                <div className="idx-name">{i.name} {isFresh && <span className="fresh-flag">· fresh</span>}</div>
                <div className="idx-meta">{i.events} events · 0 dashboards · 0 saved searches</div>
              </div>
              {selIdx === i.name && <span className="tag amber">selected</span>}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: 18, fontSize: 13.5 }}>
        It can't template your fields — it has to find them in your events.
      </p>
    </div>
  );
}
