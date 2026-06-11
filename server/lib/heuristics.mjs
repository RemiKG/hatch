// Heuristic extractor — the honest fallback when Vertex is unreachable.
// Scans real sample lines for common key/value, delimiter, IP, timestamp, code, and duration shapes and
// proposes rex extractions. These are STILL run through the same verify-by-execution gate, so the proof
// never depends on the LLM: a heuristic proposal only ships if it returns rows on the real events.

const PATTERNS = [
  // key=value  (k=v, k="v")
  { build: (lines) => {
      const keys = new Set();
      for (const l of lines.slice(0, 60)) {
        for (const m of l.matchAll(/([A-Za-z_][A-Za-z0-9_.-]{1,30})=("?)([^"\s]+)\2/g)) keys.add(m[1]);
      }
      return [...keys].slice(0, 12).map(k => ({
        field: san(k), rex: `${escRe(k)}=(?<${san(k)}>[^\\s"]+)`, why: 'key=value pair', src: 'heuristic',
      }));
    } },
  // key:value  (k:v)
  { build: (lines) => {
      const keys = new Set();
      for (const l of lines.slice(0, 60)) {
        for (const m of l.matchAll(/\b([A-Za-z_][A-Za-z0-9_.-]{1,30}):([^\s,;]+)/g)) keys.add(m[1]);
      }
      return [...keys].slice(0, 8).map(k => ({
        field: san(k) + '_c', rex: `${escRe(k)}:(?<${san(k)}_c>[^\\s,;]+)`, why: 'key:value pair', src: 'heuristic',
      }));
    } },
  // IPv4
  { build: (lines) => lines.some(l => /\b\d{1,3}(\.\d{1,3}){3}\b/.test(l))
      ? [{ field: 'ip_addr', rex: '(?<ip_addr>\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})', why: 'IPv4 address', src: 'heuristic' }] : [] },
  // HTTP-ish status code (3 digits 1xx-5xx near rc/status/code or standalone)
  { build: (lines) => lines.some(l => /\b[1-5]\d{2}\b/.test(l))
      ? [{ field: 'http_code', rex: '\\b(?<http_code>[1-5]\\d{2})\\b', why: '3-digit status code', src: 'heuristic' }] : [] },
  // duration in ms
  { build: (lines) => lines.some(l => /\d+\s?ms\b/.test(l))
      ? [{ field: 'duration_ms', rex: '(?<duration_ms>\\d+)\\s?ms\\b', why: 'duration in ms', src: 'heuristic' }] : [] },
  // HTTP method + path
  { build: (lines) => lines.some(l => /\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/.test(l))
      ? [{ field: 'http_method', rex: '\\b(?<http_method>GET|POST|PUT|DELETE|PATCH|HEAD)\\b', why: 'HTTP method', src: 'heuristic' }] : [] },
  // bytes
  { build: (lines) => lines.some(l => /bytes?[=:]\s?\d+/i.test(l))
      ? [{ field: 'bytes', rex: 'bytes?[=:]\\s?(?<bytes>\\d+)', why: 'byte count', src: 'heuristic' }] : [] },
];

export function heuristicExtractions(lines) {
  const out = [];
  const seen = new Set();
  for (const p of PATTERNS) {
    for (const prop of p.build(lines)) {
      if (seen.has(prop.field)) continue;
      seen.add(prop.field); out.push(prop);
    }
  }
  return out.slice(0, 12);
}

function san(s) { return s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'f'; }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
