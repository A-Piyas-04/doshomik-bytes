// Release Gate rules. Ported from src/lib/review/release.ts — code always wins over the AI's verdict.

export const RELEASE_DISCLAIMER = 'Advisory only. Athenyx may miss defects. You decide whether to ship.';
const SENSITIVE_STACK = new Set(['nextauth', 'authjs', 'clerk', 'stripe', 'supabase', 'firebase']);

/** Always DevOps + Quality; Security when auth/payment libraries are used or a serious security finding is open. */
export function selectReleasePersonas(map, open, max) {
  const personas = ['devops', 'quality'];
  const seriousSecurity = open.some((f) => f.persona === 'security' && (f.severity === 'HIGH' || f.severity === 'CRITICAL'));
  if (seriousSecurity || map.stack.some((s) => SENSITIVE_STACK.has(s))) personas.push('security');
  return personas.slice(0, Math.max(1, max));
}

const RANK = { NO_GO: 0, CONDITIONAL_GO: 1, GO: 2 };
const atMost = (verdict, cap) => (RANK[verdict] > RANK[cap] ? cap : verdict);

/**
 * Verdict caps (04 §10.5):
 * - open CRITICAL, or open HIGH VERIFIED_DEFECT → NO_GO
 * - open HIGH, or no test files → at most CONDITIONAL_GO
 * CI results are not available locally: Athenyx reads CI config but never runs it.
 */
export function applyVerdictCaps({ verdict, open, hasTests, hasCiConfig }) {
  const limitations = ['No CI results: Athenyx reads your CI configuration but does not run your pipeline or tests.'];
  const conditions = [];
  let result = verdict ?? 'CONDITIONAL_GO';
  if (verdict === null || verdict === undefined) limitations.push('No verdict was given; Athenyx defaulted to Conditional Go.');

  const critical = open.filter((f) => f.severity === 'CRITICAL');
  const highDefects = open.filter((f) => f.severity === 'HIGH' && f.classification === 'VERIFIED_DEFECT');
  const high = open.filter((f) => f.severity === 'HIGH');
  if (critical.length > 0 || highDefects.length > 0) result = 'NO_GO';
  if (high.length > 0) result = atMost(result, 'CONDITIONAL_GO');
  if (!hasTests) {
    result = atMost(result, 'CONDITIONAL_GO');
    conditions.push('Add automated tests for the critical paths — no test files were found.');
  }
  if (!hasCiConfig) conditions.push('Add a CI pipeline so every change is built and tested before release.');
  const blocking = [...critical, ...high.filter((f) => !critical.includes(f))];
  for (const f of blocking.slice(0, 10)) conditions.push(`Resolve or explicitly accept ${f.id}: ${f.title}`);
  return { verdict: result, blockingFindingIds: blocking.map((f) => f.id), conditions, limitations };
}
