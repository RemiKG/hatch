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
