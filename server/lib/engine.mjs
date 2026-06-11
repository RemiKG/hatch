// The Hatch engine — the cold-start loop, narrated step by step (AI Canvas trace).
// sample real events -> profile -> Gemini proposes rex -> EXECUTE-VERIFY each (keep>0 / drop 0)
// -> pick metrics (real SPL) -> arm an anomalydetection baseline (saved search) -> POST a real dashboard.
// Every step pushes a structured event via `emit` so the UI rail and the Receipt are the same source of truth.

import { buildStudioDefinition } from './dashboard.mjs';
import { heuristicExtractions } from './heuristics.mjs';

const now = () => Date.now();

// Ingest a (possibly large) raw log into a fresh index in parallel batches, then poll until searchable.
export async function ingestLog({ sp, index, sourcetype, source, text, emit, targetMin = 1 }) {
  await sp.ensureIndex(index);
  emit({ phase: 'ingest', state: 'run', msg: `fresh index ${index} created`, spl: `| ensure index=${index}` });

  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const total = lines.length;
  // Batch so a big upload still rides one auditable channel; keep batches modest for the receivers endpoint.
  const BATCH = 400;
  const batches = [];
  for (let i = 0; i < lines.length; i += BATCH) batches.push(lines.slice(i, i + BATCH).join('\n'));
  const t0 = now();
  // Parallel ingest (bounded) for speed within the 2-minute money shot.
  const CONC = 4;
  for (let i = 0; i < batches.length; i += CONC) {
    await Promise.all(batches.slice(i, i + CONC).map(b => sp.ingest(index, sourcetype, source, b)));
  }
  emit({ phase: 'ingest', state: 'done', msg: `ingested ${total} events`, ms: now() - t0, count: total });

  // Poll until the events are searchable (receivers/simple has indexing latency).
  // Use a wide window (-7d, the same the sampler uses) so events count as soon as they're indexed,
  // regardless of where their parsed _time lands — a -1h window can miss freshly-indexed events whose
  // timestamps sit just outside it, stalling the poll on a misleading 0.
  const tp = now();
  let searchable = 0;
  for (let tries = 0; tries < 40; tries++) {
    await sleep(1500);
    const rows = await sp.search(`search index=${index} | stats count`, { earliest: '-30d', latest: '+1h' });
    searchable = Number(rows[0]?.count || 0);
    emit({ phase: 'ingest', state: 'wait', msg: `indexing… ${searchable}/${total} searchable`, count: searchable });
    if (searchable >= Math.min(total, Math.max(targetMin, total * 0.95))) break;
  }
  emit({ phase: 'ingest', state: 'done', msg: `searchable: ${searchable} events`, ms: now() - tp, count: searchable });
  return { total, searchable };
}

// The full hatch, after data is in the index. Returns the final receipt object.
export async function hatch({ sp, vertex, index, opts = {}, emit }) {
  const receipt = { index, startedAt: new Date().toISOString(), steps: [], actSurface: 'rest-443' };
  // `requested` is the head() ceiling we ASK Splunk for; `n` is the denominator every count divides by.
  // After we sample, `n` is clamped down to the real number of events that came back, so the Sample
  // header, the verify badges, the Fields stamps and the Receipt all divide by the SAME real N — never a
  // ceiling the index never reached. A `head 500` over a 240-event index really only scans 240 events,
  // so 240 is the honest, genuinely-measured denominator.
  const requested = opts.sampleSize || 500;
  let n = requested;
  // Wide window so we sample/verify regardless of where the uploaded log's own timestamps land
  // (a vendor export can be hours or days old). +1h covers slight clock skew / future-stamped events.
  const earliest = opts.earliest || '-30d';
  const latest = opts.latest || '+1h';
  const trace = (t) => { receipt.steps.push({ ...t, at: Date.now() }); emit(t); };

  receipt.actSurface = await sp.actSurface();
  trace({ phase: 'connect', state: 'done', msg: `act-surface: ${receipt.actSurface === 'mcp-7931' ? 'MCP Server (app 7931)' : 'direct 443 REST proxy'}`, actSurface: receipt.actSurface });

  // 1) SAMPLE -------------------------------------------------------------
  trace({ phase: 'sample', state: 'run', msg: `sampling up to ${requested} real events`, spl: `search index=${index} | head ${requested} | table _raw` });
  let t = now();
  const raw = await sp.sampleRaw(index, requested, { earliest, latest });
  const sampleMs = now() - t;
  // The real, measured denominator for everything downstream: the events that actually came back.
  n = raw.length || requested;
  trace({ phase: 'sample', state: 'done', msg: `sampled ${raw.length} events — measured`, ms: sampleMs, count: raw.length, total: n, sampleSize: n, raw: raw.slice(0, 80) });

  // 2) PROFILE ------------------------------------------------------------
  // Profile/verify against the same real N (head ceiling unchanged — over a 240-event index head 240 and
  // head 500 scan the identical events, so fill% and hit-counts share one honest denominator).
  trace({ phase: 'profile', state: 'run', msg: 'profiling candidate columns', spl: `search index=${index} | head ${n} | fieldsummary` });
  t = now();
  let profile = [];
  try { profile = await sp.fieldSummary(index, n, { earliest, latest }); } catch (e) { trace({ phase: 'profile', state: 'warn', msg: 'fieldsummary partial: ' + e.message.slice(0, 80) }); }
  trace({ phase: 'profile', state: 'done', msg: `${profile.length} candidate columns`, ms: now() - t, profile });

  // 3) PROPOSE (Gemini, or heuristic fallback) ----------------------------
  trace({ phase: 'propose', state: 'run', msg: vertex.available ? 'Gemini (Vertex) proposing extractions…' : 'Vertex off — heuristic extractors proposing…' });
  t = now();
  let proposals = [];
  let brain = 'gemini';
  if (vertex.available) {
    try {
      proposals = await vertex.proposeExtractions(raw, profile, { maxProposals: opts.maxProposals || 9 });
      if (!proposals.length) trace({ phase: 'propose', state: 'warn', msg: 'Gemini returned no parseable proposals — heuristic fallback (verify gate unchanged)' });
    } catch (e) {
      trace({ phase: 'propose', state: 'warn', msg: 'Vertex unreachable — heuristic fallback (verify gate unchanged): ' + e.message.slice(0, 120) });
    }
  }
  if (!proposals.length) { proposals = heuristicExtractions(raw); brain = 'heuristic'; }
  // de-dup + sanitize field names
  const seen = new Set();
  proposals = proposals
    .filter(p => p && p.field && p.rex)
    .map(p => ({ ...p, field: String(p.field).replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'f', rex: normalizeRex(p.rex, String(p.field).replace(/[^A-Za-z0-9_]/g, '_')) }))
    .filter(p => { if (seen.has(p.field)) return false; seen.add(p.field); return true; })
    .slice(0, opts.maxProposals || 9);
  receipt.brain = brain;
  trace({ phase: 'propose', state: 'done', msg: `proposed ${proposals.length} extractions (${brain})`, ms: now() - t, count: proposals.length, proposals });

  // 4) VERIFY-BY-EXECUTION (the gate) -------------------------------------
  const verified = [];
  const dropped = [];
  for (const p of proposals) {
    trace({ phase: 'verify', state: 'run', field: p.field, rex: p.rex, why: p.why, msg: `running ${p.field}…` });
    const vt = now();
    let res;
    try {
      res = await sp.verifyExtraction(index, p.field, p.rex, n, { earliest, latest, previewRows: opts.previewRows || 5 });
    } catch (e) {
      dropped.push({ ...p, hits: 0, total: n, reason: 'search error: ' + e.message.slice(0, 60) });
      trace({ phase: 'verify', state: 'drop', field: p.field, rex: p.rex, hits: 0, total: n, ms: now() - vt, msg: `dropped — search error · no template to fall back on` });
      continue;
    }
    const verifySpl = `index=${index} | head ${n} | rex field=_raw "…" | where isnotnull(${p.field}) | stats count`;
    if (res.hits > 0) {
      const kept = { ...p, hits: res.hits, total: res.total, sample: res.sample, cardinality: cardOf(profile, p.field, res.sample), type: typeOf(res.sample), verifySpl };
      verified.push(kept);
      trace({ phase: 'verify', state: 'keep', field: p.field, rex: p.rex, hits: res.hits, total: res.total, sample: res.sample, ms: now() - vt, partial: res.hits < res.total * 0.9, msg: `verified — returned on ${res.hits}/${res.total} real events` });
    } else {
      dropped.push({ ...p, hits: 0, total: res.total, reason: 'returned on 0 events · no template to fall back on', verifySpl });
      trace({ phase: 'verify', state: 'drop', field: p.field, rex: p.rex, hits: 0, total: res.total, ms: now() - vt, msg: `dropped — returned on 0/${res.total} · no template to fall back on` });
    }
  }
  receipt.verified = verified; receipt.dropped = dropped;
  trace({ phase: 'verify', state: 'done', msg: `proposed ${proposals.length} · verified ${verified.length} · dropped ${dropped.length}`, verified: verified.length, droppedCount: dropped.length, proposed: proposals.length });

  // 5) METRICS (real SPL over verified fields) ----------------------------
  trace({ phase: 'metrics', state: 'run', msg: 'picking metrics worth watching…' });
  t = now();
  let metrics = [];
  if (vertex.available && verified.length) {
    try { metrics = await vertex.proposeMetrics(index, verified, { maxMetrics: opts.maxMetrics || 4 }); } catch { /* fall through */ }
  }
  if (!metrics.length) metrics = defaultMetrics(verified);
  // run each metric live so panels ship with real numbers
  const rexPrelude = verified.map(f => `| rex field=_raw "${f.rex.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
  for (const m of metrics) {
    try {
      const spl = m.spl && /^\s*\|/.test(m.spl) ? `search index=${index} ${rexPrelude} ${m.spl}` : `search index=${index} ${rexPrelude} | ${m.spl}`;
      const rows = await sp.runMetric(spl, { earliest, latest });
      m.sampleRows = rows.slice(0, 5);
      m.live = true;
    } catch (e) { m.live = false; m.error = e.message.slice(0, 60); }
  }
  receipt.metrics = metrics;
  trace({ phase: 'metrics', state: 'done', msg: `${metrics.length} metrics, computed live`, ms: now() - t, metrics });

  // 6) BASELINE (anomalydetection saved search) ---------------------------
  trace({ phase: 'baseline', state: 'run', msg: 'arming an anomaly baseline…' });
  t = now();
  const keyMetric = pickKeyMetric(verified, metrics);
  // Choose a timechart span that yields a meaningful number of populated buckets over the data's real
  // time range (avoids 10k empty 1m buckets when events span days). Then anomalydetection models the band.
  const span = await pickSpan(sp, index, earliest);
  const baselineSpl = buildBaselineSpl(index, rexPrelude, keyMetric, span);
  const baselineName = `hatch_baseline_${index}`;
  let baselineSaved, baselineBand = [];
  try {
    baselineSaved = await sp.saveSearch(baselineName, baselineSpl.replace('__INDEX__', index), { cron: opts.cron || '*/15 * * * *' });
    // run it once now to draw the first band — drop empty buckets so the sparkline reads cleanly.
    const bandRows = await sp.runMetric(baselineSpl.replace('__INDEX__', index), { earliest, latest });
    const metricCol = keyMetric.field === '_time' ? 'volume' : 'metric';
    baselineBand = bandRows.filter(r => r[metricCol] !== '' && r[metricCol] != null && Number(r[metricCol]) !== 0).slice(-120);
    if (baselineBand.length < 4) baselineBand = bandRows.slice(-120); // fall back to raw if filtering emptied it
  } catch (e) { trace({ phase: 'baseline', state: 'warn', msg: 'baseline save warn: ' + e.message.slice(0, 80) }); }
  const baseline = { name: baselineName, spl: baselineSpl, engine: 'SPL anomalydetection', metricTitle: keyMetric.title, band: baselineBand, saved: baselineSaved };
  receipt.baseline = baseline;
  trace({ phase: 'baseline', state: 'done', msg: `baseline armed: ${baselineName} (SPL anomalydetection)`, ms: now() - t, baseline });

  // 7) DASHBOARD (real Dashboard Studio POST) -----------------------------
  trace({ phase: 'dashboard', state: 'run', msg: 'shipping a Dashboard Studio app…' });
  t = now();
  const label = `Hatch — ${index}`;
  // Fit the dashboard's default time window to the data so panels fill the view (fresh uploads span minutes,
  // not the -7d sampling window). Falls back to the sampling window if the range can't be read.
  const dashEarliest = await fitWindow(sp, index, earliest);
  const studio = buildStudioDefinition({ index, label, verifiedFields: verified, metrics, baseline, earliest: dashEarliest });
  const dashName = `hatch_${index}`;
  let dash;
  try {
    dash = await sp.postDashboard(dashName, label, studio, { app: 'search', owner: 'sc_admin' });
  } catch (e) {
    trace({ phase: 'dashboard', state: 'warn', msg: 'dashboard POST warn: ' + e.message.slice(0, 120) });
    dash = { name: dashName, url: null, error: e.message.slice(0, 200) };
  }
  receipt.dashboard = dash;
  receipt.studio = studio;
  trace({ phase: 'dashboard', state: 'done', msg: dash.url ? `dashboard shipped` : 'dashboard POST failed', ms: now() - t, dashboard: dash });

  receipt.finishedAt = new Date().toISOString();
  trace({ phase: 'complete', state: 'done', msg: 'the egg is a bird.', receipt: summary(receipt) });
  return receipt;
}

// ---- helpers ----------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Splunk's PCRE rejects a regex with two capture groups of the SAME name (e.g. multi-format alternation
// "status\":(?<x>\d+)|code=(?<x>\d+)") — it returns zero and the field gets dropped. This normalizes such a
// regex into ONE named group with non-capturing prefix alternation, which is a faithful equivalent. This is
// a legitimate regex rewrite (not a fake): the resulting rex is still executed and only kept if it returns rows.
export function normalizeRex(rex, field) {
  if (typeof rex !== 'string') return rex;
  const groupRe = new RegExp(`\\(\\?<${field}>`, 'g');
  const occurrences = (rex.match(groupRe) || []).length;
  if (occurrences < 2) return rex;
  // Split on top-level alternation; for each branch, peel the (?<field>BODY) into prefix + body.
  const branches = rex.split('|');
  const prefixes = [];
  let body = null;
  for (const b of branches) {
    const m = b.match(new RegExp(`^(.*?)\\(\\?<${field}>(.*)\\)(.*)$`));
    if (!m) return rex; // shape we don't recognize — leave as-is, the gate will judge it
    prefixes.push(escapeForGroup(m[1]));
    if (body === null) body = m[2]; // assume the value pattern is consistent across branches
  }
  const prefixAlt = prefixes.filter(Boolean).join('|');
  return prefixAlt ? `(?:${prefixAlt})(?<${field}>${body})` : `(?<${field}>${body})`;
}
function escapeForGroup(s) { return s; } // prefixes are already regex fragments; keep verbatim
function cardOf(profile, field, sample) {
  const p = profile.find(x => x.field === field);
  if (p) return p.cardinality;
  return new Set(sample || []).size;
}
function typeOf(sample) {
  if (!sample?.length) return 'string';
  return sample.every(v => /^-?\d+(\.\d+)?$/.test(String(v))) ? 'numeric' : 'string';
}
function defaultMetrics(verified) {
  const out = [{ title: 'Event volume', field: '_time', agg: 'count', spl: 'timechart span=1m count' }];
  const numeric = verified.find(f => f.type === 'numeric' && /(lat|dur|ms|time|resp|size|byte)/i.test(f.field));
  if (numeric) out.push({ title: `p95 ${numeric.field}`, field: numeric.field, agg: 'p95', spl: `timechart span=5m p95(${numeric.field})` });
  const code = verified.find(f => /(code|status|rc|http)/i.test(f.field));
  if (code) out.push({ title: `Top ${code.field}`, field: code.field, agg: 'count', spl: `timechart span=5m count by ${code.field}` });
  const cat = verified.filter(f => f.type === 'string' && f.cardinality > 1 && f.cardinality < 50).sort((a, b) => b.cardinality - a.cardinality)[0];
  if (cat) out.push({ title: `Top ${cat.field}`, field: cat.field, agg: 'count', spl: `timechart span=5m count by ${cat.field}` });
  return out.slice(0, 4);
}
function pickKeyMetric(verified, metrics) {
  const numeric = verified.find(f => f.type === 'numeric' && /(lat|dur|ms|time|resp)/i.test(f.field));
  if (numeric) return { title: `p95 ${numeric.field}`, field: numeric.field, agg: 'p95' };
  return { title: 'event volume', field: '_time', agg: 'count' };
}
// Pick a timechart span so the metric has a sensible number of buckets (~30-120) over the data's range.
async function pickSpan(sp, index, earliest) {
  try {
    const rows = await sp.runMetric(`search index=${index} | stats min(_time) as a max(_time) as b`, { earliest });
    const a = Number(rows[0]?.a || 0), b = Number(rows[0]?.b || 0);
    const range = Math.max(b - a, 60); // seconds
    const target = 60; // aim for ~60 buckets
    const secs = Math.max(1, Math.round(range / target));
    if (secs <= 30) return '30s';
    if (secs <= 60) return '1m';
    if (secs <= 300) return '5m';
    if (secs <= 900) return '15m';
    if (secs <= 3600) return '1h';
    return '1d';
  } catch { return '1m'; }
}
// Pick a dashboard default earliest that comfortably covers the data's real span (with ~20% headroom).
async function fitWindow(sp, index, fallback) {
  try {
    const rows = await sp.runMetric(`search index=${index} | stats min(_time) as a max(_time) as b`, { earliest: fallback });
    const a = Number(rows[0]?.a || 0), b = Number(rows[0]?.b || 0);
    if (!a || !b) return fallback;
    const ageSec = (Date.now() / 1000) - a + 60; // how far back the oldest event is
    const padded = Math.ceil(ageSec * 1.2);
    if (padded <= 3600) return '-60m';
    if (padded <= 86400) return '-24h';
    if (padded <= 604800) return '-7d';
    return '-30d';
  } catch { return fallback; }
}
function buildBaselineSpl(index, rexPrelude, key, span = '1m') {
  if (key.field === '_time') {
    return `search index=__INDEX__ | timechart span=${span} count as volume | anomalydetection volume action=annotate`;
  }
  return `search index=__INDEX__ ${rexPrelude} | timechart span=${span} ${key.agg}(${key.field}) as metric | anomalydetection metric action=annotate`;
}
function summary(r) {
  return {
    index: r.index, brain: r.brain, actSurface: r.actSurface,
    proposed: (r.verified?.length || 0) + (r.dropped?.length || 0),
    verified: r.verified?.length || 0, dropped: r.dropped?.length || 0,
    dashboardUrl: r.dashboard?.url || null, baseline: r.baseline?.name || null,
  };
}
