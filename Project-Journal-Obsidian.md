# Project Journal — german-coach

> **Append a new dated section at the top** of this file (newest first).
> Every entry MUST use the canonical structure below — same section order, same headings.
> `New Concepts Discovered` is part of every entry; if a fresh scan finds nothing new, write a single row `| None | — | — | — |` so it's clear the scan happened and produced nothing.
> See `.cursor/rules/knowledge-capture.mdc` for the rules on **when** to add a concept row.

## Canonical entry template

````markdown
## YYYY-MM-DD

### Project Status
active / paused / completed

### Current Phase
e.g. MVP build, UI polish, architecture refactor, bug fix, productization

### What I Did
- Completed feature / fix / decision

### Files Changed
- `src/file.py` — what changed and why

### Architecture & Key Decisions
- Why this choice over the alternatives

### Blockers
- What's stuck (write `None` if nothing)

### Next
- Concrete next step(s)

### Notes for Librarian
- Knowledge points or cross-project connections worth surfacing in Obsidian

### New Concepts Discovered

| Concept | Where in code | Why it matters | One-line description |
|---------|--------------|----------------|---------------------|
| concept-name | `path/to/file.ts` | Why this is worth knowing beyond this project | 1-sentence what-it-is and how it's used here |
````

---

## 2026-05-30

### Project Status
active

### Current Phase
project bootstrap — workflow scaffolding before any product code

### What I Did
- Created the empty `D:\Projects\german-coach` workspace as a new sister project under `D:\Projects\`.
- Installed the `cursor-daily-workflow` scaffold by running `D:\Projects\cursor-daily-workflow\scripts\install.ps1 -Target D:\Projects\german-coach`, which dropped the 4 canonical files into the repo (`.cursor/rules/knowledge-capture.mdc`, `.cursor/rules/journal-workflow.mdc`, `scripts/journal-archive.ps1`, `Project-Journal-Obsidian.md`).
- Detected and fixed a UTF-8 / GBK mojibake bug in the installed `Project-Journal-Obsidian.md` — `install.ps1` had corrupted every em-dash (`—`) into `鈥?` while doing the `{{PROJECT_NAME}}` substitution on a Windows-CP936 PowerShell host. Re-wrote the file from the clean upstream template (`templates/Project-Journal-Obsidian.md` on `main`) and confirmed the other 3 files were byte-clean (they bypass the substitution path).
- Initialized git, made the first commit, and pushed to the remote.

### Files Changed
- `.cursor/rules/knowledge-capture.mdc` — installed verbatim from template; auto-capture rule for new concepts into the per-entry NCD table.
- `.cursor/rules/journal-workflow.mdc` — installed verbatim from template; trigger phrases (`today's plan:`, `log this`, `EOD`, `ship it`, `archive journal`), daily loop, EOD procedure, archive cadence.
- `scripts/journal-archive.ps1` — installed verbatim from template; monthly archive helper that moves past-month entries to `docs/journal-archive/YYYY-MM.md`.
- `Project-Journal-Obsidian.md` — re-written from clean upstream template (mojibake-free), `{{PROJECT_NAME}}` filled in as `german-coach`, this baseline entry appended.

### Architecture & Key Decisions
- **Adopt the same daily-journal contract as the other `D:\Projects\` sisters** (`swiss-job-agent-web`, `CV-site`, `permit-advisor`, `ai-builders-digest`) from day zero, before any product code lands. The point is that the workflow itself is the bootstrap — once it's wired, every subsequent day rides the `today's plan: … → log this → EOD → ship it` loop and the Obsidian librarian gets one consistently-shaped contract file to read.
- **Re-write the journal file from upstream rather than patch the mojibake in place.** Patching `鈥?` → `—` with a sed-style replace is risky if any genuine `鈥?` sequence ever appears in real content; downloading the clean template and re-doing the substitution by hand is deterministic and one-shot.
- **No project-specific `core-standards.mdc` yet** — the README recommends adding one with paths/tech-stack/domain conventions, but `german-coach` has no tech stack chosen yet. Defer until the first real implementation decision.

### Blockers
- None.

### Next
- Decide product scope for `german-coach` (the name implies a German-language tutoring/coaching tool, but no PRD exists yet) — pick target user, MVP feature set, and tech stack.
- Once tech stack is chosen, add `.cursor/rules/core-standards.mdc` with project-specific paths and conventions, including the one-line pointer to `.cursor/rules/journal-workflow.mdc` recommended in the upstream README.
- File an issue upstream (`1yiwang/cursor-daily-workflow`) about the `install.ps1` UTF-8 / CP936 mojibake — the substitution step needs to read and write the journal template with explicit UTF-8 encoding to be safe on Windows hosts whose default code page is GBK.

### Notes for Librarian
- New project `german-coach` joins the `D:\Projects\` family. Cross-link with the four existing sister projects that already use this workflow (`swiss-job-agent-web`, `CV-site`, `permit-advisor`, `ai-builders-digest`) under a shared "cursor-daily-workflow adopters" tag.
- The install-time mojibake bug is a cross-project concern — any sister installed on a Windows host with CP936 default encoding will have the same broken `Project-Journal-Obsidian.md` header. Worth surfacing in Obsidian as a known footgun so the next install gets verified for encoding before its first commit.

### New Concepts Discovered

| Concept | Where in code | Why it matters | One-line description |
|---------|--------------|----------------|---------------------|
| cursor-daily-workflow | `.cursor/rules/journal-workflow.mdc` | Project-agnostic daily-journal contract reusable across every repo, single contract file with Obsidian on the read side | A 4-file scaffold (`knowledge-capture.mdc`, `journal-workflow.mdc`, `journal-archive.ps1`, `Project-Journal-Obsidian.md`) that wires the Cursor agent into a fixed `today's plan: → log this → EOD → ship it → archive journal` trigger-phrase loop. |
| cp936-utf8-substitution-pitfall | `scripts/journal-archive.ps1` (upstream `install.ps1`) | Any PowerShell script that reads a UTF-8 file, does string replacement, and writes it back will corrupt non-ASCII characters when the host's default code page is GBK/CP936 unless encoding is pinned explicitly | Symptom seen here: em-dashes (`—`, UTF-8 `E2 80 94`) became `鈥?` (`E9 88 A5 3F`) — the bytes were round-tripped through CP936 during the `{{PROJECT_NAME}}` replace; fix is `[System.IO.File]::ReadAllText/WriteAllText` with an explicit `UTF8Encoding($false)`. |

---
