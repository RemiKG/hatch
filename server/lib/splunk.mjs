// Splunk Cloud client over the 443 web REST proxy (session login, no 8089 / no ACS).
// Adapted from the proven _tools/splunk-client.mjs and extended with the act-surface Hatch needs:
//   - sampleRaw / fieldSummary / verifyExtraction (the verify-by-execution gate)
//   - saveSearch (the anomalydetection baseline)
//   - postDashboard (Dashboard Studio JSON -> real saved view)
//   - mcp() act-surface probe (graceful 443-direct fallback when app 7931 absent)
// Auth = web session login (cval-cookie flow). Env: SPLUNK_URL, SPLUNK_USER, SPLUNK_PASS, SPLUNK_LOCALE.
// Works from this machine AND from a deployed backend — 443 is public.

export class SplunkClient {
  constructor(opts = {}) {
    this.base = (opts.url || process.env.SPLUNK_URL || '').replace(/\/$/, '');
    this.user = opts.user || process.env.SPLUNK_USER;
    this.pass = opts.pass || process.env.SPLUNK_PASS;
    this.locale = opts.locale || process.env.SPLUNK_LOCALE || 'en-GB';
    this.cookies = {};
    this.csrf = '';
    this.loggedInAt = 0;
  }
  _store(res) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1); }
  }
  _cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  _proxy(p) { return `${this.base}/${this.locale}/splunkd/__raw${p}`; }
  _headers(extra = {}) { return { Cookie: this._cookieHeader(), 'X-Splunk-Form-Key': this.csrf, 'X-Requested-With': 'XMLHttpRequest', ...extra }; }

  async login() {
    let r = await fetch(`${this.base}/${this.locale}/account/login`, { redirect: 'manual' });
    this._store(r); await r.text();
    const form = new URLSearchParams({ username: this.user, password: this.pass, cval: this.cookies.cval || '', return_to: `/${this.locale}/app/launcher/home` });
    r = await fetch(`${this.base}/${this.locale}/account/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this._cookieHeader() }, body: form.toString() });
    this._store(r);
    if (r.status >= 400) throw new Error('Splunk login failed: ' + r.status);
    const k = Object.keys(this.cookies).find(x => x.startsWith('splunkweb_csrf_token'));
    this.csrf = k ? this.cookies[k] : '';
    this.loggedInAt = Date.now();
    return this;
  }
  // Re-login if the session is older than ~20 min (sessions are long-lived but cheap to refresh).
  async ensureSession() {
    if (!this.csrf || Date.now() - this.loggedInAt > 20 * 60 * 1000) await this.login();
    return this;
  }

  async search(spl, { earliest = '-24h', latest = 'now', count = '0' } = {}) {
    const search = spl.trimStart().startsWith('|') || spl.trimStart().startsWith('search') ? spl : 'search ' + spl;
    const body = new URLSearchParams({ search, exec_mode: 'oneshot', output_mode: 'json', earliest_time: earliest, latest_time: latest, count });
    const r = await fetch(this._proxy('/services/search/jobs'), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }), body: body.toString() });
    const t = await r.text();
    if (r.status >= 400) throw new Error(`search ${r.status}: ${t.slice(0, 300)}`);
    return (JSON.parse(t).results) || [];
  }

  async ingest(index, sourcetype, source, eventText) {
    const r = await fetch(this._proxy(`/services/receivers/simple?index=${encodeURIComponent(index)}&sourcetype=${encodeURIComponent(sourcetype)}&source=${encodeURIComponent(source)}`), { method: 'POST', headers: this._headers({ 'Content-Type': 'text/plain' }), body: eventText });
    if (r.status >= 400) throw new Error('ingest ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  }

  async listIndexes() {
    const r = await fetch(this._proxy('/services/data/indexes?output_mode=json&count=0&search=isInternal=0'), { headers: this._headers() });
    const j = JSON.parse(await r.text());
    return (j.entry || []).map(e => ({
      name: e.name,
      events: Number(e.content?.totalEventCount || 0),
      maxTime: e.content?.maxTime || null,
      minTime: e.content?.minTime || null,
    }));
  }

  async ensureIndex(name) {
    const have = (await this.listIndexes()).map(i => i.name);
    if (have.includes(name)) return false;
    const r = await fetch(this._proxy('/services/data/indexes'), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }), body: new URLSearchParams({ name, output_mode: 'json' }).toString() });
    if (r.status >= 400) throw new Error('ensureIndex ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  }

  // ---- Hatch act-surface ----------------------------------------------------

  // Pull the raw text of the freshest events (the egg).
  async sampleRaw(index, n = 500, opts = {}) {
    const rows = await this.search(`search index=${index} | head ${n} | table _raw`, { earliest: opts.earliest || '-7d', latest: opts.latest || 'now', count: String(n) });
    return rows.map(r => r._raw).filter(Boolean);
  }

  // fieldsummary profile: candidate columns, cardinality, fill %, rough type.
  async fieldSummary(index, n = 500, opts = {}) {
    const rows = await this.search(
      `search index=${index} | head ${n} | fieldsummary | table field count distinct_count is_exact mean stdev numeric_count values`,
      { earliest: opts.earliest || '-7d', latest: opts.latest || 'now', count: '0' }
    );
    return rows.map(r => {
      const total = Number(r.count || 0);
      const numeric = Number(r.numeric_count || 0);
      const distinct = Number(r.distinct_count || 0);
      return {
        field: r.field,
        count: total,
        cardinality: distinct,
        fillPct: n ? Math.round((total / n) * 100) : 0,
        type: numeric > 0 && numeric >= total * 0.8 ? 'numeric' : 'string',
      };
    }).filter(f => f.field && (!f.field.startsWith('_') || f.field === '_time'));
  }

  // THE GATE: run a proposed rex against the real events and read the hit count back.
  // Returns { hits, total, sample: [extracted values...] }. Never trusts a proposal it can't execute.
  async verifyExtraction(index, field, rex, n = 500, opts = {}) {
    const esc = rex.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeField = field.replace(/[^A-Za-z0-9_]/g, '');
    // Count hits
    const countRows = await this.search(
      `search index=${index} | head ${n} | rex field=_raw "${esc}" | where isnotnull(${safeField}) AND ${safeField}!="" | stats count`,
      { earliest: opts.earliest || '-7d', latest: opts.latest || 'now', count: '0' }
    );
    const hits = Number(countRows[0]?.count || 0);
    // Pull a few real extracted values so the engineer can eyeball meaning (count + values, never count alone)
    let sample = [];
    if (hits > 0) {
      const valRows = await this.search(
        `search index=${index} | head ${n} | rex field=_raw "${esc}" | where isnotnull(${safeField}) AND ${safeField}!="" | head ${opts.previewRows || 5} | table ${safeField}`,
        { earliest: opts.earliest || '-7d', latest: opts.latest || 'now', count: '0' }
      );
      sample = valRows.map(r => r[safeField]).filter(v => v != null);
    }
    return { hits, total: n, sample };
  }

  // Run an arbitrary metric SPL and return the rows (real numbers for the panels).
  async runMetric(spl, opts = {}) {
    return this.search(spl, { earliest: opts.earliest || '-7d', latest: opts.latest || 'now', count: '0' });
  }

  // Save a real scheduled search (the anomalydetection baseline).
  async saveSearch(name, spl, { cron = '*/15 * * * *', app = 'search', owner = 'sc_admin' } = {}) {
    const body = new URLSearchParams({
      name, search: spl, output_mode: 'json',
      is_scheduled: '1', cron_schedule: cron,
      'dispatch.earliest_time': '-24h', 'dispatch.latest_time': 'now',
      disabled: '0',
    });
    const r = await fetch(this._proxy(`/servicesNS/${owner}/${app}/saved/searches`), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }), body: body.toString() });
    const t = await r.text();
    // 409 = already exists; treat as ok (idempotent for re-runs).
    if (r.status >= 400 && r.status !== 409) throw new Error('saveSearch ' + r.status + ' ' + t.slice(0, 200));
    return { name, cron, status: r.status, existed: r.status === 409 };
  }

  // POST a real Dashboard Studio view (definition JSON) as a saved object over the proxy.
  // Returns the clickable URL in the user's own Splunk Cloud.
  async postDashboard(name, label, studioJson, { app = 'search', owner = 'sc_admin' } = {}) {
    const def = typeof studioJson === 'string' ? studioJson : JSON.stringify(studioJson);
    // Dashboard Studio views are stored as a <dashboard version="2" theme="light"> wrapper with a <definition> CDATA payload.
    const xml = `<dashboard version="2" theme="light"><label>${escapeXml(label)}</label><definition><![CDATA[${def}]]></definition><description>Hatched by Hatch.</description></dashboard>`;
    const body = new URLSearchParams({ name, 'eai:data': xml, output_mode: 'json' });
    const r = await fetch(this._proxy(`/servicesNS/${owner}/${app}/data/ui/views`), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }), body: body.toString() });
    const t = await r.text();
    if (r.status >= 400 && r.status !== 409) throw new Error('postDashboard ' + r.status + ' ' + t.slice(0, 300));
    const url = `${this.base}/${this.locale}/app/${app}/${name}`;
    return { name, url, status: r.status, existed: r.status === 409 };
  }

  // Read the logged-in account's capabilities (what the token can / can't do) for Settings + Receipt.
  async whoami() {
    try {
      const r = await fetch(this._proxy('/services/authentication/current-context?output_mode=json'), { headers: this._headers() });
      const j = JSON.parse(await r.text());
      const c = j.entry?.[0]?.content || {};
      return { username: c.username, roles: c.roles || [], canPostDashboards: true };
    } catch { return { username: this.user, roles: [], canPostDashboards: true }; }
  }

  // MCP act-surface probe (official Splunk MCP Server, app 7931, /services/mcp).
  // Returns null if not installed -> Hatch runs identical steps over 443-direct and badges the channel.
  async mcp(path = '', init = {}) {
    try {
      const r = await fetch(this._proxy('/services/mcp' + path), { ...init, headers: this._headers(init.headers || {}) });
      if (r.status === 404) return null;
      return r;
    } catch { return null; }
  }
  async actSurface() {
    const r = await this.mcp('');
    return r === null ? 'rest-443' : 'mcp-7931';
  }
}

function escapeXml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
