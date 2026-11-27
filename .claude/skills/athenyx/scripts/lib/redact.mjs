// Secret redaction for stored evidence snippets. Ported from src/lib/repo/redact.ts.
// Line count is preserved exactly so line numbers stay valid; values are never returned.

export const REDACTED = '[REDACTED_SECRET]';

const blank = (match) => REDACTED + '\n'.repeat(match.split('\n').length - 1);

const RULES = [
  { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, replace: blank },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: blank },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: blank },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, replace: blank },
  { pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}\b/g, replace: blank },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, replace: blank },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: blank },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replace: blank },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: blank },
  {
    // `apiKey = "…"`, `CLIENT_SECRET: '…'`, `"password": "…"` — key name kept, value replaced.
    pattern: /([A-Za-z0-9_]*(?:password|passwd|secret|api[_-]?key|token)[A-Za-z0-9_]*["']?\s*[:=]\s*)(["'])([^"'\s]{8,})\2/gi,
    replace: (match, prefix, quote, value) => (value === REDACTED ? match : `${prefix}${quote}${REDACTED}${quote}`),
  },
];

/** Replaces likely secrets with [REDACTED_SECRET], keeping the line count. */
export function redactSecrets(text) {
  let count = 0;
  let out = String(text ?? '');
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match, ...rest) => {
      const groups = rest.slice(0, -2).map((g) => (typeof g === 'string' ? g : ''));
      const replaced = rule.replace(match, ...groups);
      if (replaced !== match) count += 1;
      return replaced;
    });
  }
  return { text: out, count };
}
