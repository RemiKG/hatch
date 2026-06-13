// DEMO EGG — a deliberately messy, multi-format raw log generated fresh each run so the money shot is
// reproducible when a judge has no file handy. This is REAL data ingested into a REAL fresh index; the
// verify counts are still computed live. DEMO EGG is stamped on every screen while the toggle is on.
// The default path is a real upload — this is the labelled, clearly-separated fallback only.

export function makeDemoEgg(n = 500) {
  const lines = [];
  const tenants = ['acme', 'globex', 'initech', 'umbrella', 'soylent'];
  const codes = [200, 200, 200, 200, 201, 301, 404, 404, 500, 503];
  const methods = ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'];
  const paths = ['/v2/orders', '/v2/things', '/v1/auth/login', '/health', '/v2/orders/{id}', '/metrics'];
  const regions = ['eu-west-1', 'us-east-2', 'ap-south-1'];
  const start = Date.now();
  for (let i = 0; i < n; i++) {
    const t = new Date(start - i * 700).toISOString();
    const code = codes[i % codes.length];
    const lat = code >= 500 ? 800 + Math.floor(Math.random() * 1500) : 15 + Math.floor(Math.random() * 400);
    const ip = `10.${i % 256}.${(i * 7) % 256}.${(i * 13) % 256}`;
    const tenant = tenants[i % tenants.length];
    const method = methods[i % methods.length];
    const path = paths[i % paths.length];
    const region = regions[i % regions.length];
    const bytes = 200 + Math.floor(Math.random() * 9000);
    const rid = Math.random().toString(36).slice(2, 12);
    // Deliberately oddball, non-standard vendor format (no template matches this exactly):
    lines.push(
      `<${t}> svc=edge-gw rgn=${region} tnt:${tenant} src=${ip} rid=${rid} >> ${method} ${path} rc=${code} dur=${lat}ms bytes=${bytes} ua="vendorSDK/3.${i % 9}"`
    );
  }
  return lines.join('\n');
}
