---
name: doshomik-feature-check
description: The "done" checklist for a Doshomik Bytes feature. Run it before reporting any backend feature as finished.
---

# Feature done checklist

Go through each line and report any that fail; don't skip silently.

1. **In scope.** The feature is in the Prototype v1 doc and not in "Left out of v1". There's no half-built scaffolding for later features.
2. **Schema.** Any schema change is a new migration (see `doshomik-migration`), and `src/db/types.ts` has been regenerated.
3. **Shared values.** Enum lists and limits used by both the client and the server are in `packages/shared`.
4. **API.** It follows `doshomik-api-endpoint`: zod-validated, auth and ownership checked on the server, cursor pagination, notifications in the same transaction, the standard error shape.
5. **Uploads**, if any, follow `doshomik-media-upload`.
6. **Tests.** Tests cover the flow and its failure cases. `pnpm --filter @doshomik/api test` passes.
7. **Types.** `pnpm --filter @doshomik/api typecheck` passes.
8. **Docs.** The endpoint table in `apps/api/README.md` is updated.
9. **Review.** Run `/code-review` on the diff. Run `/security-review` after auth or upload changes.
10. **Git.** Don't commit, stage, push or branch. List the changed files for the owner, who does all git work.
