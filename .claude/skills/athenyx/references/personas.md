# The Athenyx review board

Nine core specialists, one conditional specialist and the Evidence Arbiter. In this plugin the specialists are **lenses one agent applies in a single pass**, not separate agents, so seating more of them costs little; reading more code is what costs tokens.

| Key | Specialist | Looks at | Does not flag |
|---|---|---|---|
| `architecture` | Architecture Skeptic | Boundaries, layering, technology choices vs. real scale, coupling, business logic in the wrong layer | Style, naming, equally valid tool preferences |
| `security` | Security Adversary | Authentication vs **authorization** (ownership), injection, secrets, SSRF, CSRF, insecure defaults, risky dependencies | Theory with no path from attacker input; generic hardening |
| `data_integrity` | Data Integrity Auditor | Schemas, constraints, migrations, transactions, races, money precision, idempotent writes | Performance-only issues; schema naming |
| `reliability` | Reliability & Performance Engineer | Timeouts, retries + idempotency, N+1 queries, unbounded work, caching, error recovery | Micro-optimizations on small bounded inputs |
| `quality` | Quality & Testing Critic | Logic correctness, edge cases, missing/weak tests for risky logic | Test style; coverage percentages for trivial code |
| `product_ux` | Product & UX Guardian | User flows vs requirements, error/empty/loading states, accessibility basics | Visual taste |
| `devops` | DevOps & Operations Auditor | CI, env/config handling, build/deploy, migration rollout/rollback, logging, recovery | Cloud vendor preferences |
| `algorithms` | Algorithm & Data Structure Specialist | Correctness and complexity relative to **realistic** input sizes; data-structure choice | O(n²) on tiny bounded inputs |
| `code_quality` | Code Quality & Maintainability Engineer | Duplicated logic, mixed responsibilities, leaky abstractions, hard-to-change modules | Long-but-cohesive files, formatting |
| `ai_ml` | AI/ML Systems Auditor (conditional) | Prompt-injection paths, model-output validation, data leakage into prompts/logs, eval/monitoring, cost controls | Model or vendor preferences |
| `evidence_arbiter` | Evidence Arbiter (code, not AI) | Checks every quote against the real file, drops claims it cannot match, merges duplicates, caps the list | — |

**Boundaries.** Testing asks whether behaviour is *correct*; Product & UX asks whether it is the *right* behaviour. A long file is not automatically bad, and O(n²) is not automatically unacceptable — context decides.

## Who gets seated

`scan` seats lenses in code, before any AI is involved:

- **Default (`--depth standard`)**: every lens with a real signal — hotspots it found, the review type's default seats, words in your request, stack signals (UI framework → Product & UX, database → Data Integrity, …) — at least 3, at most 5.
- `--depth quick`: at most 3. `--depth deep`: all nine.
- `--all`: all nine regardless of depth. `--personas security,data`: exactly those.
- The AI/ML Auditor joins only when the project uses AI libraries or your request mentions AI.
- `release` always seats DevOps + Quality, plus Security when auth/payment libraries are used or a serious security finding is open.
- `recheck` seats the specialists who raised the findings being re-checked.

## Stances

Specialists don't vote. Each seated lens's stance is derived from its findings that survived the Arbiter: **Flags serious issues** (a critical/high finding), **Has concerns** (any finding), **Signs off** (none). At the Release Gate a lens also answers for findings still open in its area.
