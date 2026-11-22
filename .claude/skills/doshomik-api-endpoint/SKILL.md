---
name: doshomik-api-endpoint
description: Recipe for adding or changing an HTTP endpoint in apps/api (Fastify + zod + Kysely, Prototype 2 conventions). Use whenever you add a route, change a request or response shape, or touch auth, visibility, pagination, rate limits, the outbox or the audit log in the Doshomik Bytes backend.
---

# Adding an endpoint to apps/api

Scope check first. The feature must be in `docs/Prototype 2 — Features, Database, Security & Efficiency.md` (on top of the Prototype v1 doc), or the owner asked for it. Check `docs/prototype-2-implementation-notes.md` §3–4 for work that was deliberately deferred.

## Where code goes

- `src/modules/<area>/<area>.routes.ts`: the route, its zod schemas, and a call into the service. Admin CMS handlers may hold their own single-statement queries.
- `src/modules/<area>/<area>.service.ts`: Kysely queries and rules. Plain arguments in, plain objects out.

Reuse these; don't re-implement them:

- `lib/validation.ts`: `idParams` (UUID), `slugParams`, `text`, `optionalText` (`""` → null), `httpUrl`, `uniqueIds`, `updateOf`
- `db/visibility.ts`: `isVisiblePost`, `canSeeProfile`, `canSeeContentOf`, `isSearchablePost`, `isPublished`, `notBlocked`. **Every** query returning user or team content uses these.
- `lib/pagination.ts`: `pageQuery`, `fetchPage(query, alias | { createdAt, id }, page, order)`, `mapPage`
- `lib/outbox.ts`: `emit(trx, type, entityId, payload)` and `emitSearchSync(trx, entity, id)`
- `lib/audit.ts`: `audit(trx, request, { action, entityType, entityId, changes })` for every admin or security action
- `lib/rate-limits.ts`: `perIp(n)` before sign-in, `perUser(n)` after
- `lib/errors.ts`: `badRequest`, `forbidden`, `notFound`, `conflict`, `found(row, 'Thing')`
- `modules/users/user-summary.ts` (`userSummary('u')`), `modules/media/media.service.ts` (`MEDIA_COLUMNS`, `mediaView`, `withMediaView`)

## Rules

1. **`/v1` only.** Routes live inside the `/v1` scope in `src/app.ts`. Signed-in routes go in the scope with `authenticate`; use `request.auth.userId`, never an id from the body.
2. **Public ids only.** Accept UUIDs (`idParams`) or slugs, and return `public_id as id`. Never expose internal numeric ids, including foreign keys. Resolve them to internal ids in the service.
3. **Validate everything with zod,** with bounds on every string and array. Enum values come from `@doshomik/shared`.
4. **Object-level checks.** Use a visibility helper, or load the row and check ownership. Return 404 (not 403) when the caller may not know the row exists.
5. **Staff routes** go in `modules/admin/*`, under `requireRole('moderator' | 'admin')`, which also enforces 2FA. Write an `audit` entry in the same transaction.
6. **Slow or side work goes through the outbox:** counters, notifications, push, email, search sync. `emit` in the same transaction as the change, then add or extend the handler in `src/worker/outbox.ts`. Handlers must be idempotent: recount, don't increment.
7. **Lists use `fetchPage`** (cursor, max 50). Small fixed lists (topics, fields) return `{ items }`.
8. **Throw errors; don't build them by hand.** Add a stable `code` when the client needs to branch on it.
9. **Status codes:** 201 for a create, with the resource as the body; 204 for toggles and deletes; 202 for accepted async work.
10. **Never select `password_hash` or `totp_secret`** outside the auth module.
11. **Tests** go in `apps/api/test/*.test.ts` with `useTestApp`, `createUser` (`{ role: 'admin' }` gives a staff user with 2FA), `call`, `runWorker` and `upload`. Cover the happy path, visibility and ownership failures, and each new rule.
12. Run `pnpm --filter @doshomik/api typecheck` and `test`. Update the endpoint tables in `apps/api/README.md`. Record any decision you made in `docs/prototype-2-implementation-notes.md`.
