// Thin client over the Hatch backend. Same-origin in prod, Vite-proxied in dev — no hardcoded host/port.
const BASE = '/api';

export async function getHealth() {
  const r = await fetch(`${BASE}/health`);
  return r.json();
}
export async function getIndexes() {
  const r = await fetch(`${BASE}/indexes`);
  return r.json();
}
export async function startHatch(payload) {
  const r = await fetch(`${BASE}/hatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}
export async function getReceipt(id) {
  const r = await fetch(`${BASE}/hatch/${id}`);
  return r.json();
}
// Subscribe to the live SSE trace. onEvent gets each structured step; returns a close() fn.
export function streamHatch(id, onEvent, onDone) {
  const es = new EventSource(`${BASE}/hatch/${id}/stream`);
  es.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data);
      onEvent(ev);
      if (ev.phase === 'final' || ev.phase === 'error') { es.close(); onDone?.(ev); }
    } catch { /* ignore malformed */ }
  };
  es.onerror = () => { es.close(); onDone?.({ phase: 'closed' }); };
  return () => es.close();
}
