# Hatch.

**From bytes to a dashboard before the coffee's done.**

Point Hatch at a fresh Splunk index. ~2 minutes later there's a clickable Dashboard Studio app.

## The core loop

1. Ingest a raw log into a fresh per-run index over the Splunk 443 REST proxy.
2. Sample the real events with `| head 500` and `| fieldsummary`.
3. Propose `rex` extractions with Gemini on Vertex AI.
4. Verify each proposal by running it against the live events — 0 rows is a hard drop.
5. Build a Dashboard Studio view from the fields that survived.

(more docs to come)
