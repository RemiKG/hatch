// The Hatch. wordmark. The visual pun is in the H: a ladder-hatch (two uprights + a rung);
// the amber rung-pip doubles as the 'verified' stamp. A trailing period (the pip) closes the wordmark.
export function HatchGlyph({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="6" width="3" height="20" rx="1.5" fill="var(--ink)" />
      <rect x="20" y="6" width="3" height="20" rx="1.5" fill="var(--ink)" />
      <rect x="9" y="14.5" width="14" height="3" rx="1.5" fill="var(--amber)" />
      <circle cx="16" cy="16" r="2.6" fill="var(--amber)" />
    </svg>
  );
}

export function Wordmark({ size = 25 }) {
  return (
    <span className="brand">
      <HatchGlyph size={size + 3} />
      <span className="wordmark" style={{ fontSize: size }}>
        Hatch<span className="dot">.</span>
      </span>
    </span>
  );
}
