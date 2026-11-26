# .api-guide

Generates [`docs/api-guide.html`](../docs/api-guide.html), an interactive guide to the backend in `apps/api`. Nothing in this folder is imported by the app, and the app does not depend on it.

## Regenerate

Run this after changing routes, services, the worker or `guide.json`:

```
node .api-guide/run.mjs
```

The command runs two steps:

1. **`extract.mts`** reads the backend and writes `facts.json`. It runs with `tsx` from `apps/api`, so the app's packages and `.env` resolve.
   - **Runtime pass.** It builds the real Fastify app with `buildApp()` and records every route Fastify registers: method, URL, zod request schemas (as JSON Schema) and rate limit. It does not listen, and it sends no database queries because the pool is lazy.
   - **Static pass.** It parses `apps/api/src` with rolldown's TypeScript parser, which vitest already installs. It walks the plugin tree from `app.ts` to get prefixes and guards. It then follows each handler through the functions it calls to find the tables read and written, outbox events, audit actions, errors, notifications and outside services. The worker loops and outbox handlers are followed the same way.
   - **Cross-check.** It compares the two passes and prints any route found by only one of them. Expected: `GET /media/public/*`, which `@fastify/static` registers.
2. **`build.mjs`** combines `template.html`, `facts.json` and `guide.json` into `docs/api-guide.html`.

## Files

| File | What it is | Edit by hand? |
| --- | --- | --- |
| `run.mjs` | Runs extract, then build | Rarely |
| `extract.mts` | Reads the backend and writes `facts.json` | When the code's patterns change |
| `facts.json` | The extracted data | No, it is generated |
| `guide.json` | Module names and descriptions, access tiers, the text for each request stage, worker notes, conventions | Yes |
| `template.html` | The page: styles, views, diagrams | Yes |
| `build.mjs` | Embeds the data into the template | Rarely |

## What the guide shows

- **Overview.** Counts, who may call what, and where to start.
- **Map.** The two processes and the route tiers. A module ↔ table graph that focuses on click. A module × table matrix.
- **Endpoints.** All routes, with search and filters. Each endpoint has tabs:
  - Flow: the pipeline of stages for this route.
  - Request: fields from the zod schema, and a curl command that uses the `x-dev-user` dev bypass.
  - Data: tables read and written.
  - Errors.
  - Code path: the call tree.
- **Journey.** Follow one endpoint step by step, from the client to the worker. Use ← and → to move.
- **Events.** Who writes each outbox event and what the worker does with it.
- **Worker.** The four loops and their idle intervals.
- **Access.** The plugin tree with its guards, and every rate limit.
- **Reference.** Every error code, environment variables, providers and API conventions.

Table names link to the schema guide (`docs/schema-guide.html#table/<name>`), and table colours follow its areas (`.schema-guide/guide.json`).

## Limits

The analysis reads code, not runtime behaviour. A branch that never runs still counts, and a call through a variable it cannot resolve is missed. It does handle these patterns:

- `lifecycleRoutes('/papers', 'papers')`, with the arguments bound to the parameters.
- `for (const thread of threads)` route loops.
- `searchers[type](…)` lookup tables.
- Functions declared inside a plugin.
