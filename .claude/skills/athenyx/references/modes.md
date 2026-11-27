# Modes and commands

| Command | Web app equivalent | What `scan` plans to read |
|---|---|---|
| `scan health ["focus"]` | Project Health | Hotspot windows for the seated lenses, the manifest, schema/CI when relevant, then core modules to fill the budget |
| `scan changes [--base <ref>]` | Latest Changes | The diff since the last Athenyx run's commit (else the merge-base with main, else `HEAD~1`) **plus uncommitted edits**, the changed hunks, and the callers of changed modules |
| `scan ask "question"` | Ask About My Codebase | Files whose path or content mention your words, plus relevant hotspots |
| `scan proposal "idea"` | Proposal Review | Code the idea would touch; concerns may rest on your description (`userPremise`) |
| `scan issue "symptom"` | Issue Investigation | Code matching the symptom; causes are ranked with checks — never a claimed reproduction |
| `scan release` | Release Gate | CI and config files, recent migrations, entry points, plus open findings; verdict capped by fixed rules |
| `scan recheck [ATX-…]` | Re-check | Only the cited code of those findings (default: up to 8 open ones), with a note on whether it changed |

Flags: `--all`, `--personas a,b`, `--depth quick|standard|deep` (reading budget ≈ 900 / 2200 / 4500 lines), `--base <ref>`, `--root <dir>`.

## Ledger commands (no code is read)

| Command | Effect |
|---|---|
| `decide ATX-001 2 "why"` | Records a decision (DEC-###) for option 2, lists the other options as ruled out, sets the finding in progress |
| `status ATX-001 accepted "why"` | `open`, `in-progress`, `accepted` (risk), `dismissed` (false positive), `resolved` (manual: shown as "resolved by you, not verified"). A note is required for the last three |
| `list` | Open findings, decisions and recent reports |
| `report [--open]` | Re-renders the latest review with the current ledger into a new file |
| `install <claude\|agents\|antigravity\|gemini\|all>` | Copies the skill where your AI tool looks (`--project`, `--path <dir>`, `--dry-run`) |
| `doctor` | Checks Node, git, write access and the template |

## Files

- `athenyx-reports/athenyx-<mode>-<YYYY-MM-DD_HH-mm-ss>-<sha7>.html` — never overwritten
- `athenyx-reports/index.html` — every report, newest first
- `.athenyx/ledger.json` — findings, statuses, checks, decisions, run history
- `.athenyx/session.json` — the current scan; `.athenyx/runs/` — each run's data and the agent's raw findings

## Token budget, roughly

`scan` output ≈ 2–4k tokens. Reading: quick ≈ 10–15k, standard ≈ 20–30k, deep ≈ 40–60k (≈ 7–10 tokens per line). Writing findings ≈ 3–8k. `build` output < 1k. The agent never reads the whole repository and never writes HTML.
