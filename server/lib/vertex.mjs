// Gemini on Vertex AI — the agent's reasoning brain (drafts rex/spath, picks metrics, names the baseline).
// Auth, two ways:
//   (a) a service-account key (GOOGLE_APPLICATION_CREDENTIALS) -> mint a short-lived OAuth token from the
//       signed JWT (no extra deps). Used for local dev.
//   (b) on Cloud Run with a bound service account: no key file — read an access token straight from the
//       instance metadata server (Application Default Credentials). This is the preferred prod path.
// Either way we call the REST :generateContent endpoint. The agent NEVER decides the truth: every rex it
// proposes is re-executed against real events and kept only if it returns rows. If Vertex is unreachable,
// the heuristic extractor stands in — the verify gate is unchanged.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const METADATA = 'http://metadata.google.internal/computeMetadata/v1';

export class VertexAgent {
  constructor(opts = {}) {
    this.keyPath = opts.keyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    this.project = opts.project || process.env.VERTEX_PROJECT || '';
    this.location = opts.location || process.env.VERTEX_LOCATION || 'global';
    this.model = opts.model || process.env.VERTEX_MODEL || 'gemini-flash-latest';
    // Use the metadata-server (ADC) path when no key file is configured AND we look like we're on GCP.
    this.useMetadata = !this.keyPath && (!!process.env.K_SERVICE || !!process.env.GCP_METADATA);
    this._sa = null;
    this._token = null;
    this._tokenExp = 0;
  }

  _sa_() {
    if (this._sa) return this._sa;
    if (!this.keyPath) throw new Error('no GOOGLE_APPLICATION_CREDENTIALS');
    this._sa = JSON.parse(readFileSync(this.keyPath, 'utf8'));
    if (!this.project) this.project = this._sa.project_id;
    return this._sa;
  }

  // Available if we have either a key file OR a bound SA on Cloud Run (metadata server).
  get available() { return !!this.keyPath || this.useMetadata; }

  async _token_() {
    if (this._token && Date.now() < this._tokenExp - 60_000) return this._token;
    if (this.useMetadata) {
      // Bound-SA path: pull an access token from the Cloud Run instance metadata server (no key file).
      const r = await fetch(`${METADATA}/instance/service-accounts/default/token`, { headers: { 'Metadata-Flavor': 'Google' } });
      const j = await r.json();
      if (!j.access_token) throw new Error('metadata token failed: ' + JSON.stringify(j).slice(0, 200));
      if (!this.project) {
        try { const p = await fetch(`${METADATA}/project/project-id`, { headers: { 'Metadata-Flavor': 'Google' } }); this.project = (await p.text()).trim(); } catch { /* keep env */ }
      }
      this._token = j.access_token; this._tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
      return this._token;
    }
    const sa = this._sa_();
    const now = Math.floor(Date.now() / 1000);
    const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const c = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, iat: now, exp: now + 3600 }));
    const signer = createSign('RSA-SHA256'); signer.update(`${h}.${c}`);
    const jwt = `${h}.${c}.${b64url(signer.sign(sa.private_key))}`;
    const r = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
    const j = await r.json();
    if (!j.access_token) throw new Error('Vertex token mint failed: ' + JSON.stringify(j).slice(0, 200));
    this._token = j.access_token; this._tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return this._token;
  }

  async generate(prompt, { temperature = 0.2, maxOutputTokens = 4096, retries = 2 } = {}) {
    if (!this.useMetadata) this._sa_(); // resolves project from the key file when present
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const token = await this._token_(); // also resolves this.project on the metadata path
        const url = `https://aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;
        // gemini-flash-latest is a *thinking* model: internal "thoughts" eat the output budget and can
        // truncate the visible answer mid-JSON. For these structured extraction tasks we want the JSON, not
        // reasoning, so we set thinkingBudget=0 (faster, deterministic) AND keep a generous output cap.
        const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } } }) });
        const j = await r.json();
        if (r.status === 403 && i < retries) { await new Promise(s => setTimeout(s, 4000)); continue; } // fresh-SA IAM propagation
        if (r.status >= 400) throw new Error(`Vertex ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
        return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      } catch (e) { lastErr = e; if (i < retries) await new Promise(s => setTimeout(s, 1500)); }
    }
    throw lastErr;
  }

  // Ask Gemini for rex extraction proposals from the real sample lines (drafted as AI-Assistant-for-SPL would).
  async proposeExtractions(rawLines, profile, { maxProposals = 9 } = {}) {
    const cols = (profile || []).slice(0, 40).map(p => `${p.field} (card ${p.cardinality}, ${p.type})`).join(', ');
    const prompt = `You are the Splunk AI Assistant for SPL, an expert at writing Splunk field extractions.
A brand-new sourcetype just landed in a fresh index. Below are real raw event lines from it (never-before-seen format) and the auto-extracted field profile.
Propose up to ${maxProposals} Splunk \`rex\` field extractions that a data engineer would hand-write to turn this wall of text into named, useful fields (e.g. status_code, latency_ms, client_ip, tenant_id). Use named capture groups. Prefer specific, high-value fields over trivial ones.

CRITICAL Splunk PCRE rules (a violation makes the regex return zero and get dropped):
- Each regex must contain the named group EXACTLY ONCE: (?<field>...). NEVER repeat the same group name (Splunk rejects "(?<x>a)|(?<x>b)").
- If a field appears in several line formats, capture it with ONE named group using non-capturing alternation for the prefix, e.g. "(?:status\\":|code=|rc=)(?<status_code>\\d+)".
- Match only the value in the capture group, not the key.

Return ONLY a JSON array. Each item exactly: {"field":"snake_case_name","rex":"regex with (?<field>...)","why":"one short clause"}
No markdown fences, no prose.

Auto-extracted profile: ${cols || '(none)'}

Raw sample lines:
${rawLines.slice(0, 40).join('\n')}`;
    const reply = await this.generate(prompt, { temperature: 0.2, maxOutputTokens: 2048 });
    return parseJsonArray(reply);
  }

  // From verified fields + cardinalities, pick the handful of metrics worth watching (each becomes real SPL).
  async proposeMetrics(index, verifiedFields, { maxMetrics = 4 } = {}) {
    const fields = verifiedFields.map(f => `${f.field} (${f.type}, card ${f.cardinality}, e.g. ${(f.sample || []).slice(0, 2).join(', ')})`).join('\n');
    const prompt = `You are a Splunk monitoring expert. A fresh index "${index}" now has these VERIFIED extracted fields (each proven on real events):
${fields}

Pick the ${maxMetrics} metrics that actually matter for monitoring THIS source (e.g. error rate, p95 latency, top talkers, request volume). For each, write a single valid SPL line that computes it as a timechart or stats over index=${index} (use the rex inline is NOT needed — assume fields are available via | rex in a base search you will be given; just reference the field names directly after a leading \`| rex\`-free timechart). Keep each SPL to one pipeline.

Return ONLY a JSON array. Each item exactly: {"title":"human label","field":"primary field","agg":"avg|p95|count|dc|sum","spl":"timechart span=... <agg>(<field>) ..."}
No markdown, no prose.`;
    const reply = await this.generate(prompt, { temperature: 0.2, maxOutputTokens: 1024 });
    return parseJsonArray(reply);
  }
}

// Tolerant parser. LLMs emit regex inside JSON strings with single backslashes (e.g. "(?<x>\d+)"),
// which are INVALID JSON escapes and crash JSON.parse. We repair lone backslashes that aren't part of a
// valid JSON escape (\" \\ \/ \b \f \n \r \t \uXXXX) by doubling them, then parse. Falls back to []
// (engine then uses the heuristic extractor — proof gate unchanged either way).
export function parseJsonArray(text) {
  if (!text) return [];
  let s = text.trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('['); const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  // try strict first (Gemini sometimes double-escapes correctly)
  try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch { /* repair below */ }
  // repair: any backslash NOT followed by a valid JSON escape char gets doubled
  const repaired = s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  try { const v = JSON.parse(repaired); return Array.isArray(v) ? v : []; } catch { return []; }
}
