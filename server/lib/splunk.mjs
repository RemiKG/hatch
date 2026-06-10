// Splunk Cloud client over the 443 web REST proxy. WIP: auth + oneshot search.
const enc = (s) => encodeURIComponent(s);

export function makeSplunk({ url, user, pass }) {
  const base = url.replace(/\/+$/, '');
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  async function search(spl) {
    const r = await fetch(`${base}/services/search/jobs/export?output_mode=json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `search=${enc(spl)}`,
    });
    const text = await r.text();
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  return { search };
}
