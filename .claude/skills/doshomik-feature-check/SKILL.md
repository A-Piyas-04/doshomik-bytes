---
name: doshomik-feature-check
description: The "done" checklist for a Doshomik Bytes backend feature. Run it before reporting any backend feature as finished.
---

# Feature done checklist

Go through each line and report any that fail; don't skip silently.

1. **In scope.** The feature is in the Prototype v1 or Prototype 2 doc, or the owner asked for it. Neither doc was edited.
2. **Schema.** Any schema change is a new migration with a working down step (`doshomik-migration`), and `src/db/types.ts` has been regenerated.
3. **Shared values.** Enum lists and limits used by both client and server are in `packages/shared`.
4. **API.** It follows `doshomik-api-endpoint`:
   - `/v1`, public ids only;
   - zod validation, visibility helpers, ownership checks;
   - cursor pagination, rate limits where it writes;
   - an audit entry for staff and security actions.
5. **Async work** (counters, notifications, push, email, search) goes through the outbox, and its worker handler is idempotent.
6. **Uploads**, if any, follow `doshomik-media-upload`.
7. **Tests** cover the flow and its failure cases, including visibility (private, blocked, draft, deleted). `pnpm --filter @doshomik/api test` passes.
8. **Types.** `pnpm --filter @doshomik/api typecheck` passes.
9. **Docs.** The endpoint tables in `apps/api/README.md` are updated. Every decision taken, and anything deliberately left for later, is recorded in `docs/prototype-2-implementation-notes.md`, with how to finish it.
10. **Review.** Run `/code-review` on the diff. Run `/security-review` after auth, upload or permission changes.
11. **Git.** Don't commit, stage, push or branch. List the changed files for the owner, who does all git work.
