# Hatch.

**From bytes to a dashboard before the coffee's done.**

Point Hatch at a fresh Splunk index. ~2 minutes later there's a clickable Dashboard Studio app — and **every field on it is stamped `verified on your real events`, not a stock template.**

> It can't template your fields — it has to find them in your events.

Platform & Developer Experience track · Splunk Agentic Ops Hackathon · target bonus: Best Use of MCP Server / Developer Tools.

---

## The problem

A new source lands in a fresh index on a Tuesday and sits **dark and unmonitored** for weeks, because turning raw bytes into a usable view is hand-written `rex`, eyeballed fields, named metrics, and a dashboard nobody has time to build. Hatch is the agent that cold-starts that index in two minutes — and **proves every field it finds by running it against your real events.**

## The one mechanic

Point at an egg → watch it hatch on a single live rail. Each proposed extraction **runs against your real 500 events** and lands a verdict: teal **`verified — 500/500`** or grey **`dropped — 0/500`**. A field ships only if it parsed real bytes. A faked engine has no template for a format it's never seen — the `returned on N/500` count is the unfakeable proof.

## The core loop (what actually runs, live)

1. **Ingest** an uploaded raw log into a fresh per-run index over the Splunk 443 REST proxy (`ensureIndex` + `receivers/simple`), then poll until searchable.
2. **Sample** — `search index=<new> | head 500 | table _raw` reads the actual raw text; `| fieldsummary` profiles candidate columns, per-field cardinality, fill %, type. Every number is `— measured`.
3. **Propose** — the real sample lines + profile go to **Gemini on Vertex AI**, which returns `rex` field extractions a data engineer would hand-write (`status_code`, `latency_ms`, `client_ip`, `tenant_id`…).
4. **Verify by execution (the gate)** — each proposal is re-run as `… | rex "<proposed>" | where isnotnull(<field>) | stats count` against the live events; Hatch reads the count back. **>0 keeps it (with a values preview); 0 is a hard drop.** Gemini never wins on its own.
5. **Metrics** — from the verified fields, pick the handful worth watching (error rate, p95 latency, top talkers), each run as real SPL so panels ship with real numbers.
6. **Baseline** — a real **`anomalydetection`** scheduled saved search is created on the key metric, so the source is monitored from minute one.
7. **Dashboard** — valid **Dashboard Studio v2 JSON** is POSTed as a real saved view (`data/ui/views`); the returned URL is clickable in the user's own Splunk Cloud.

What **persists lives in the user's own Splunk Cloud**: the uploaded events (the new index), the saved scheduled search (the baseline), and the saved Dashboard Studio view (the artifact). Hatch keeps only lightweight, non-authoritative run receipts in memory for the Receipt screen.

## Architecture

```
repo/
├── server/                       # Node + Express backend (ESM, no build step)
│   ├── index.mjs                 # HTTP API + SSE live trace; serves the built web app in prod (single origin)
│   ├── lib/
│   │   ├── splunk.mjs            # Splunk Cloud client over the 443 web REST proxy (session login):
│   │   │                         #   sampleRaw · fieldSummary · verifyExtraction (THE GATE) ·
│   │   │                         #   saveSearch · postDashboard · actSurface (MCP probe) · whoami
│   │   ├── vertex.mjs            # Gemini on Vertex AI — SA-key → minted OAuth token → :generateContent.
│   │   │                         #   proposeExtractions / proposeMetrics. thinkingBudget=0 for clean JSON.
│   │   ├── engine.mjs            # The hatch loop, narrated step-by-step (sample→propose→verify→metrics→
│   │   │                         #   baseline→dashboard). normalizeRex repairs multi-format alternations.
│   │   ├── heuristics.mjs        # Honest fallback extractors if Vertex is unreachable (gate unchanged).
│   │   └── dashboard.mjs         # Builds Dashboard Studio v2 definition JSON from verified fields + metrics.
│   └── data/demo-egg.mjs         # DEMO EGG generator (a deliberately messy multi-format log).
├── web/                          # Vite + React frontend (THW enterprise-clean skin)
│   └── src/
│       ├── App.jsx               # Shell, nav, SSE stream → screen state reducer
│       └── screens/              # Point · Sample · Hatch (money shot) · Fields · Baseline ·
│                                 #   Dashboard · Receipt · Settings
└── samples/                      # Two ready-to-upload sample logs (vendor-edge-gateway, messy-multiformat)
```

**The 443 web REST proxy is the only door.** No 8089, no ACS (firewalled on this stack). Everything — sample, verify-execute, baseline save, dashboard POST — rides one auditable session-login channel that works from this machine and from any deployed backend.

**Act surface (MCP bonus seam).** Hatch probes for the official Splunk **MCP Server** (app 7931, `/services/mcp`). If present, it's the act-surface; if not (404), Hatch runs the **identical** steps over the 443 REST proxy directly. A badge always shows which channel is live. The bonus narrows when MCP is absent; the product is unchanged.

## What is REAL vs. honest fallback

- **REAL, end-to-end, for a stranger on their own data:** ingest → sample/profile → Gemini proposes → **execute-verify each extraction (kept only if it returns rows)** → arm an `anomalydetection` saved search → POST a real Dashboard Studio view. Verified on the live stack: a never-seen log becomes a clickable dashboard with correctly extracted fields, real panel numbers, and a live baseline.
- **DEMO EGG** (clearly labelled): a bundled messy multi-format log so the money shot is reproducible with no file handy. `DEMO EGG` is stamped on screen the whole time. Every `verified: N/500` is still a real returned count.
- **Gemini fallback:** if Vertex is unreachable, heuristic extractors stand in — the verify-by-execution gate is unchanged, so the proof never depends on the LLM.
- **Hosted Models seam:** if Cisco Deep Time-Series / Foundation-sec enable, the baseline upgrades to a forecast band and fields get a security-relevance flag. If not (default), the baseline is SPL-native `anomalydetection` (real Splunk ML) and the flag is hidden — *same armed baseline, named honestly.*

The floor is **Gemini + the 443 proxy + core SPL**, and the floor ships the whole money shot.

## Run it

Requires Node 18+ (global `fetch`). Secrets via env only — never committed.

```bash
# 1) configure (copy and fill — see .env.example)
cp .env.example .env
#   SPLUNK_URL / SPLUNK_USER / SPLUNK_PASS   (the 443 proxy session)
#   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/vertex-sa.json
#   VERTEX_PROJECT / VERTEX_LOCATION=global / VERTEX_MODEL=gemini-flash-latest

# 2) install everything (server + web)
npm run install:all

# 3a) production single-origin (recommended): build the web app, the server serves it
npm run build:web
npm start                       # → http://localhost:8787  (PORT env to change)

# 3b) or dev with hot reload (two terminals)
npm run dev:server              # backend on :8787
npm run dev:web                 # web on :5173, proxies /api → backend
```

Open the app, drop a raw log (or flip **DEMO EGG**), hit **Hatch it**, and watch the rail. When it finishes, click **Open in Splunk** to see the real dashboard render with your data. Two sample logs are in `samples/`.

## Deploy (Cloud Run, single origin)

Hatch ships with a `Dockerfile` that builds the web app and runs the Express server (which serves it). On Google Cloud Run, bind a service account that has `roles/aiplatform.user` and Vertex works with **no key file** — `server/lib/vertex.mjs` reads an access token straight from the instance metadata server (Application Default Credentials) when no `GOOGLE_APPLICATION_CREDENTIALS` is set. Splunk creds come from the service config.

```bash
gcloud run deploy hatch \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account <SA-with-aiplatform.user>@<project>.iam.gserviceaccount.com \
  --set-env-vars SPLUNK_URL=...,SPLUNK_USER=...,SPLUNK_PASS=...,SPLUNK_LOCALE=en-GB,VERTEX_PROJECT=...,VERTEX_LOCATION=global,VERTEX_MODEL=gemini-flash-latest \
  --memory 1Gi --port 8080
```

(For Vercel or a plain VM, set `GOOGLE_APPLICATION_CREDENTIALS` to a mounted SA key instead — both auth paths are supported.)

### Environment variables

| Var | Purpose |
|---|---|
| `SPLUNK_URL` `SPLUNK_USER` `SPLUNK_PASS` | Splunk Cloud 443 web-proxy session login |
| `SPLUNK_LOCALE` | proxy locale path segment (default `en-GB`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to the Vertex service-account JSON key (on Cloud Run, bind the SA instead) |
| `VERTEX_PROJECT` `VERTEX_LOCATION` `VERTEX_MODEL` | Gemini on Vertex (`global` / `gemini-flash-latest`) |
| `PORT` | backend port (default `8787`) |

No hardcoded hosts or ports in client code: the web app calls `/api` (same origin in prod, Vite-proxied in dev).

## Notes & limits

- **Verification ≠ semantics.** A `verified: 500/500` stamp proves the extraction *parsed*, not that the field *means* its name — so Hatch shows the real extracted values beside every count.
- **Bounded sample.** Verification runs against `| head <N>` (default 500) for speed; "verified on a 500-event sample," never "validated at scale." Re-sample on demand.
- **Multi-format sources** yield honest partial hits (e.g. `160/240`); Hatch surfaces the partial and offers to split per format. `normalizeRex` merges duplicate-named alternations so a single field captures across formats.
- **Dashboard embedding.** Splunk Cloud sets `X-Frame-Options`, so the dashboard can't render inside another page — that's Splunk's security, not a mock. The view is real; open it in Splunk to see it live.
