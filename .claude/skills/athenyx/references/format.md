# `.athenyx/findings.json`

The agent writes this file once per review; `build` validates it. Plain JSON, UTF-8, no comments. Enum values are case-insensitive (`"potential risk"` works).

```json
{
  "summary": "2-4 sentences: the board's overall view",
  "answer": null,
  "verdict": null,
  "conditions": [],
  "specialists": [
    { "persona": "security", "statement": "2-3 sentences in this lens's voice", "noSignificantIssues": false }
  ],
  "findings": [
    {
      "persona": "security",
      "existingId": null,
      "title": "Expense delete has no ownership check",
      "evidence": [
        { "path": "app/api/expenses/[id]/route.ts", "startLine": 29, "endLine": 29, "symbol": "DELETE",
          "quote": "await db.expense.delete({ where: { id } });" }
      ],
      "observation": "DELETE checks that a user is signed in, then deletes by id without checking group membership.",
      "impact": "Any signed-in user can delete other groups' expenses.",
      "classification": "VERIFIED_DEFECT",
      "severity": "HIGH",
      "confidence": "HIGH",
      "userPremise": null,
      "options": [
        { "title": "Check membership first", "description": "…", "pros": ["Small change"], "cons": ["Easy to forget elsewhere"], "effort": "SMALL" },
        { "title": "Scope the query by user", "description": "…", "pros": ["One query enforces it"], "cons": ["Compound where"], "effort": "SMALL" }
      ],
      "recommendation": { "optionIndex": 0, "rationale": "A membership helper already exists." },
      "verification": "Call DELETE as a user outside the group: expect 404."
    }
  ],
  "rechecks": [],
  "limitations": ["What you could not see or check"]
}
```

| Field | Rules |
|---|---|
| `summary` | Required. The board's overall view. |
| `answer` | Markdown. Required for `ask`, `proposal`, `issue`; `null` otherwise. Reference code as `path:line`. |
| `verdict`, `conditions` | `release` only. `GO`, `CONDITIONAL_GO` or `NO_GO`. Code caps it: an open CRITICAL or HIGH verified defect → `NO_GO`; any open HIGH or no tests → at most `CONDITIONAL_GO`. |
| `specialists` | One per seated lens, even when it found nothing (`noSignificantIssues: true`). |
| `persona` | A seated lens key (aliases like `data`, `sec`, `ux` work). One finding has one owner; the Arbiter merges duplicates across lenses. |
| `existingId` | The `ATX-###` id of a prior finding listed in the brief, when it is the same issue. |
| `evidence` | 1+ items. `path` repo-relative (absolute paths inside the repo are accepted). `quote` = 1–3 consecutive lines copied exactly. Line numbers may be a little off: the Arbiter re-anchors within ±10 lines, or anywhere the quote occurs exactly once. |
| `classification` | `VERIFIED_DEFECT` (needs HIGH confidence and evidence, else downgraded to `POTENTIAL_RISK`), `POTENTIAL_RISK`, `DESIGN_CONCERN`. |
| `severity` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`. CRITICAL with LOW confidence is lowered to HIGH. |
| `userPremise` | `proposal`/`issue` only: the developer's own statement a finding rests on. Such findings may have no code evidence; their confidence is capped at MEDIUM. |
| `options` | Up to 3, each with `title`, `description`, `pros[]`, `cons[]`, `effort` (`SMALL`/`MEDIUM`/`LARGE`). |
| `recommendation.optionIndex` | 0-based index into `options`, or `null`. |
| `rechecks` | `recheck` only: `{ "id", "result": "RESOLVED" \| "STILL_PRESENT" \| "PARTIALLY_RESOLVED" \| "UNVERIFIABLE", "reasoning", "evidence": [] }`. RESOLVED is accepted only when the cited code changed or you cite evidence of the fix; otherwise it becomes UNVERIFIABLE. |

## What the Evidence Arbiter does

1. Resolves each `path`; refuses files outside the repo and secret/ignored/binary files.
2. Finds the quote (cited lines → ±10 lines → unique match anywhere). Strips line-number prefixes copied from file readers.
3. Copies the snippet **from disk** (secrets redacted) — the model's text is never stored as evidence.
4. Drops findings with no valid evidence (except premise findings in `proposal`/`issue`), applies the downgrades above, keeps at most 4 per lens.
5. Merges duplicates (overlapping lines + similar titles, or the same `existingId`), sorts by severity then confidence, keeps the top 15 (20 for `--all`/`deep`).
6. Links repeats to the ledger instead of creating new ids; a RESOLVED finding that reappears is reopened.

On the first `build`, any problem stops the build and is listed so the agent can fix it once; the second `build` (or `--accept`) writes the report with whatever survives.
