// Hatch backend — Express + SSE. Wraps the live Splunk 443 proxy + Vertex Gemini agent.
// Endpoints:
//   GET  /api/health          -> connection + act-surface + agent availability (for Settings)
//   GET  /api/indexes         -> live index list with un-extracted / fresh flags (for Point)
//   POST /api/hatch           -> start a hatch run (upload text OR demo egg OR existing index); returns runId
//   GET  /api/hatch/:id/stream-> SSE live trace (sample -> verify rail -> baseline -> dashboard)
//   GET  /api/hatch/:id       -> final receipt (JSON, for export)
// No secrets in client code; everything reads env. No hardcoded ports (PORT env, default below).

import express from 'express';
import { randomUUID } from 'node:crypto';
import { SplunkClient } from './lib/splunk.mjs';
import { VertexAgent } from './lib/vertex.mjs';
import { ingestLog, hatch } from './lib/engine.mjs';
import { makeDemoEgg } from './data/demo-egg.mjs';

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.text({ limit: '12mb', type: ['text/plain'] }));

// Shared singletons (session is reused; re-login handled by ensureSession).
const sp = new SplunkClient();
const vertex = new VertexAgent();
let loggedIn = false;
async function splunk() { if (!loggedIn) { await sp.login(); loggedIn = true; } else { await sp.ensureSession(); } return sp; }

// In-memory run registry (receipts persist in Splunk; Hatch keeps only lightweight run traces).
const runs = new Map(); // id -> { events:[], done:bool, receipt, listeners:Set }

function pushEvent(run, ev) {
  run.events.push(ev);
  for (const res of run.listeners) {
    try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* client gone */ }
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await splunk();
    const [who, surface] = await Promise.all([sp.whoami(), sp.actSurface()]);
    res.json({
      ok: true,
      splunk: { url: sp.base, user: sp.user, connected: true, ...who },
      actSurface: surface,
      mcp: surface === 'mcp-7931',
      agent: { provider: 'gemini-vertex', model: vertex.model, project: vertex.project || 'rapid-agents-5166', location: vertex.location, available: vertex.available },
      hostedModels: { enabled: false, note: 'not enabled → SPL anomalydetection fallback (real Splunk ML)' },
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message, splunk: { connected: false }, agent: { available: vertex.available } });
  }
});

app.get('/api/indexes', async (req, res) => {
  try {
    await splunk();
    const idx = await sp.listIndexes();
    res.json({ ok: true, indexes: idx });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Start a hatch. Body: { mode:'upload'|'demo'|'index', text?, filename?, index?, demoEgg?, options? }
app.post('/api/hatch', async (req, res) => {
  try {
    await splunk();
    const b = req.body || {};
    const id = randomUUID().slice(0, 8);
    const run = { id, events: [], done: false, receipt: null, listeners: new Set(), startedAt: Date.now() };
    runs.set(id, run);
    const emit = (ev) => pushEvent(run, ev);

    // Resolve the egg.
    const demoEgg = b.mode === 'demo';
    let index = b.index;
    let text = b.text;
    let sourcetype = b.sourcetype || 'hatch:upload';
    let source = b.filename || (demoEgg ? 'demo-egg.log' : 'upload.log');

    res.json({ ok: true, runId: id, demoEgg });

    // Run async; the client subscribes to the SSE stream.
    (async () => {
      try {
        if (b.mode === 'index' && index) {
          emit({ phase: 'point', state: 'done', msg: `pointed at existing index ${index}`, index, demoEgg });
        } else {
          if (demoEgg) { text = makeDemoEgg(b.options?.sampleSize || 500); sourcetype = 'hatch:demo'; }
          if (!text || !text.trim()) throw new Error('no log text provided');
          index = `hatch_${(demoEgg ? 'demo' : 'egg')}_${Date.now().toString(36)}`;
          emit({ phase: 'point', state: 'run', msg: `pointed at the egg → fresh index ${index}`, index, demoEgg });
          await ingestLog({ sp, index, sourcetype, source, text, emit });
        }
        run.index = index;
        const receipt = await hatch({ sp, vertex, index, opts: { ...(b.options || {}), demoEgg }, emit });
        receipt.demoEgg = demoEgg;
        run.receipt = receipt;
        run.done = true;
        emit({ phase: 'final', state: 'done', msg: 'hatch complete' });
      } catch (e) {
        emit({ phase: 'error', state: 'error', msg: e.message });
        run.done = true; run.error = e.message;
      } finally {
        for (const res2 of run.listeners) { try { res2.end(); } catch {} }
      }
    })();
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/hatch/:id/stream', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).end(); return; }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  // replay any events already emitted (so a late subscriber catches up)
  for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  if (run.done) { res.end(); return; }
  run.listeners.add(res);
  req.on('close', () => run.listeners.delete(res));
});

app.get('/api/hatch/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ ok: false }); return; }
  res.json({ ok: true, done: run.done, error: run.error || null, receipt: run.receipt, events: run.events });
});

// Serve the built web app in production (single-origin → no hardcoded API host needed in client).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
const __dir = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dir, '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.listen(PORT, () => console.log(`Hatch backend on :${PORT} (Splunk ${sp.base || '(no SPLUNK_URL)'}, agent ${vertex.available ? vertex.model : 'OFF→heuristic'})`));
