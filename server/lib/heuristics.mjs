// Heuristic extractor — fallback when Vertex is unreachable. First cut: kv + IPv4 only.
const PATTERNS = [
  { build: (lines) => {
      const keys = new Set();
      for (const l of lines.slice(0, 60)) {
        for (const m of l.matchAll(/([A-Za-z_][A-Za-z0-9_.-]{1,30})=("?)([^"\s]+)\2/g)) keys.add(m[1]);
      }
      return [...keys].slice(0, 12).map(k => ({
        field: san(k), rex: `${escRe(k)}=(?<${san(k)}>[^\s"]+)`, why: 'key=value pair', src: 'heuristic',
      }));
    } },
  { build: (lines) => lines.some(l => /\b\d{1,3}(\.\d{1,3}){3}\b/.test(l))
      ? [{ field: 'ip_addr', rex: '(?<ip_addr>\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', why: 'IPv4 address', src: 'heuristic' }] : [] },
];

export function heuristicExtractions(lines) {
  const out = []; const seen = new Set();
  for (const p of PATTERNS) for (const prop of p.build(lines)) {
    if (seen.has(prop.field)) continue; seen.add(prop.field); out.push(prop);
  }
  return out.slice(0, 12);
}
function san(s) { return s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'f'; }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\]/g, '\$&'); }
