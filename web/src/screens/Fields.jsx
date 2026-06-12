import { useState } from 'react';

export default function Fields({ run }) {
  const { verified, dropped } = run;
  const [showDropped, setShowDropped] = useState(false);

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Fields — verified detail</h1>
        <p>Count <em>plus</em> values, never count alone — so you eyeball that <span className="mono">tenant_id</span> really holds tenant IDs. Recognizable values from your own data.</p>
      </div>

      <div className="card">
        <div className="card-h">{verified.length} kept fields · each proven on real events</div>
        {verified.length === 0 && <div className="muted">no verified fields yet…</div>}
        {verified.map((f, i) => (
          <div key={i} className="field-row">
            <div>
              <div className="field-name">{f.field}</div>
              {f.partial && <span className="tag amber" style={{ marginTop: 6 }}>partial — split per format?</span>}
            </div>
            <div>
              <div className="field-rex">{f.rex}</div>
              <div className="field-vals">
                {(f.sample || []).slice(0, 6).map((v, j) => <span key={j} className="val-chip">{String(v)}</span>)}
                {(!f.sample || f.sample.length === 0) && <span className="muted" style={{ fontSize: 12.5 }}>values loading…</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="tag teal">verified — {f.hits}/{f.total}</span>
            </div>
          </div>
        ))}

        {dropped.length > 0 && (
          <div className="dropped-foot">
            <button className="nav-item" style={{ width: 'auto', display: 'inline-flex' }} onClick={() => setShowDropped(v => !v)}>
              <span className="tag grey">{dropped.length} dropped</span>
              <span className="muted" style={{ fontSize: 13 }}>couldn't verify these — {showDropped ? 'hide' : 'show'}</span>
            </button>
            {showDropped && (
              <div style={{ marginTop: 12 }}>
                {dropped.map((d, i) => (
                  <div key={i} className="field-row" style={{ opacity: .75 }}>
                    <div className="field-name" style={{ color: 'var(--grey)', textDecoration: 'line-through' }}>{d.field}</div>
                    <div><div className="field-rex">{d.rex}</div><div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{d.reason || 'returned on 0 events'}</div></div>
                    <div style={{ textAlign: 'right' }}><span className="tag grey">{d.hits}/{d.total}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="muted" style={{ marginTop: 16, fontSize: 13.5 }}>
        A <span className="mono">verified: N/{run.sample.count || 500}</span> stamp proves the extraction <em>parsed</em>, not that the field means what its name says — that's why the real values sit right beside the count.
      </p>
    </div>
  );
}
