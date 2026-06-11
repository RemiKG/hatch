// Build valid Dashboard Studio (v2) definition JSON from verified fields + real metrics + the baseline.
// This JSON is POSTed as a real saved view over the 443 proxy and is clickable in the user's Splunk Cloud.
// Every panel's search references the live index with an inline `| rex` of the VERIFIED extractions, so the
// panels render the user's own real numbers — no placeholders.

export function buildStudioDefinition({ index, label, verifiedFields, metrics, baseline, earliest = '-7d' }) {
  // Inline rex prelude that re-applies every verified extraction (so studio panels have the fields).
  const rexPrelude = verifiedFields
    .map(f => `| rex field=_raw "${f.rex.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(' ');

  const dataSources = {};
  const viz = {};
  const layoutItems = [];
  let dsN = 0, vizN = 0;
  const W = 1200, colW = 600, rowH = 280;

  const addPanel = (title, spl, type, options = {}) => {
    const dsId = `ds_search_${dsN++}`;
    const vizId = `viz_${vizN++}`;
    dataSources[dsId] = {
      type: 'ds.search',
      options: { query: spl, queryParameters: { earliest, latest: 'now' } },
      name: title,
    };
    viz[vizId] = { type, title, dataSources: { primary: dsId }, options };
    const i = layoutItems.length;
    layoutItems.push({
      type: 'block', item: vizId,
      position: { x: (i % 2) * colW, y: Math.floor(i / 2) * rowH, w: colW, h: rowH - 20 },
    });
    return vizId;
  };

  // 1) Event volume over time (always meaningful for a fresh source)
  addPanel(
    'Event volume',
    `index=${index} | timechart span=1m count`,
    'splunk.line',
  );

  // 2) Each proposed metric, computed live (real numbers)
  for (const m of (metrics || []).slice(0, 3)) {
    const base = `index=${index} ${rexPrelude} `;
    // metric.spl may already be a timechart/stats pipeline; prepend the base search + rex.
    const spl = m.spl && /^\s*\|/.test(m.spl) ? base + m.spl : `${base}| ${m.spl || `timechart span=5m count`}`;
    const type = m.agg === 'count' || m.agg === 'sum' ? 'splunk.column' : 'splunk.line';
    addPanel(m.title || m.field || 'metric', spl, type);
  }

  // 3) The anomaly baseline panel (the same SPL the saved search runs) — band drawn from the user's data
  if (baseline?.spl) {
    addPanel(
      `Anomaly baseline — ${baseline.metricTitle || 'key metric'}`,
      baseline.spl.replace('__INDEX__', index),
      'splunk.line',
    );
  }

  // 4) A verified-fields table panel (top values of the highest-cardinality kept field)
  const topField = [...(verifiedFields || [])].sort((a, b) => (b.cardinality || 0) - (a.cardinality || 0))[0];
  if (topField) {
    addPanel(
      `Top ${topField.field}`,
      `index=${index} ${rexPrelude} | top limit=10 ${topField.field}`,
      'splunk.table',
    );
  }

  return {
    title: label,
    description: 'Hatched by Hatch. — every field verified on real events.',
    visualizations: viz,
    dataSources,
    inputs: {},
    layout: {
      type: 'grid',
      options: { width: W, height: Math.ceil(layoutItems.length / 2) * rowH + 40 },
      structure: layoutItems,
      globalInputs: [],
    },
    defaults: { dataSources: { 'ds.search': { options: { queryParameters: { earliest, latest: 'now' } } } } },
  };
}
