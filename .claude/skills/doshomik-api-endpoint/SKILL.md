---
name: doshomik-api-endpoint
description: Recipe for adding or changing an HTTP endpoint in apps/api (Fastify + zod + Kysely). Use whenever you add a route, change a request or response shape, or touch auth, pagination or notifications in the Doshomik Bytes backend.
---

# Adding an endpoint to apps/api

Scope check first: the feature must be in `docs/Prototype v1 — Features, User Flows & Database Schema.md` and not under "Left out of v1". If it isn't, stop and ask.

## Where code goes

- `src/modules/<area>/<area>.routes.ts`: the route, its zod schemas, and a call into the service. No SQL here, except in the admin CMS routes, where each handler is a single CRUD statement.
- `src/modules/<area>/<area>.service.ts`: Kysely queries and business rules. Plain arguments in, plain objects out. No `request` or `reply`.
- Shared helpers already exist. Reuse them; don't re-implement them:
  - `lib/validation.ts`: `id`, `idParams`, `text(max)`, `optionalText(max)` (`""` → null), `httpUrl`, `updateOf(schema)` for PATCH bodies
  - `lib/pagination.ts`: `pageQuery` and `fetchPage(query, alias, page, 'asc' | 'desc')`
  - `lib/errors.ts`: `badRequest`, `forbidden`, `notFound`, `conflict`, `found(row, 'Thing')`
  - `modules/users/user-summary.ts`: `userSummary('u')` for author or actor objects
  - `db/search.ts`: full-text and trigram conditions that match the migration's indexes
  - `modules/notifications/notifications.service.ts`: `notify(trx, …)`

## Steps

1. **Validate everything with zod** in `schema: { params, querystring, body }`. Use `idParams` for `:id`. Bound every string and array (`text(2000)`, `.max(…)`). Enum values come from `@doshomik/shared`, and they mirror the schema's `CHECK`s.
2. **Auth.** Routes registered inside the protected scope in `src/app.ts` already require a JWT (`request.user.id`). Admin routes go in `modules/admin/*` and inherit `requireAdmin`. Never trust a user id from the body.
3. **Ownership.** For edits and deletes of user content, load the row, return 404 if it's missing and 403 if `user_id !== request.user.id`.
4. **Lists use cursor pagination.** Accept `pageQuery`, select `<alias>.id` as `id`, and return `fetchPage(...)`, which gives `{ items, next_cursor }`. Never use offset. Small fixed lists (topics, fields) return `{ items }`.
5. **Notifications** (follow, like, comment, reply): call `notify(trx, …)` inside the **same transaction** as the action, and only when a row was actually created (use `onConflict(doNothing).returning(...)` and check the result). `notify` already skips self-notifications.
6. **Errors** are thrown, never sent by hand. The error handler maps `HttpError`, zod errors and Postgres constraint errors to `{ error: { code, message } }`. Add a stable `code` when the client needs to branch on it.
7. **Status codes.** Use 201 for a create, with the created resource as the body. Use 204 for PUT or DELETE toggles (follow, like, status removal). Use 200 otherwise.
8. **Never select `password_hash`** outside `auth.service.ts`. Use `ACCOUNT_COLUMNS` or `userSummary`.
9. **Test it** in `apps/api/test/*.test.ts` with `useTestApp()`, `createUser()` and `app.inject`. Cover the happy path, auth or ownership failures, and each validation rule the endpoint adds.
10. Run `pnpm --filter @doshomik/api typecheck` and `pnpm --filter @doshomik/api test`, then add the endpoint to the table in `apps/api/README.md`.
