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
v0.1 framework scaffold complete — UI shell + SRS algorithm + sample article ready; LLM/Convex wiring pending

### What I Did
- **Bootstrap (morning).** Created the empty `D:\Projects\german-coach` workspace, installed the `cursor-daily-workflow` scaffold via `install.ps1 -Target D:\Projects\german-coach`, fixed a UTF-8/CP936 mojibake bug in the generated `Project-Journal-Obsidian.md` (em-dashes turned into `鈥?` during `{{PROJECT_NAME}}` substitution on a Windows-default-codepage host) by re-downloading the clean upstream template, then `git init` + first commit + `gh repo create 1yiwang/german-coach --public --source=. --push`.
- **Studied [HashBrowns-fries/Lumina](https://github.com/HashBrowns-fries/Lumina) (v1.6.0)** focusing on four reusable bits: SM-2 spaced-repetition (`services/srsService.ts`, ~60 LOC), double-click word-save flow (mentioned in `README_zh.md`), the `Reader.tsx` + `TermSidebar.tsx` reading layout, and the `Term` data model (`types.ts` + zod schema in `services/dataModels.ts`).
- **Built the v0.1 Next.js framework.** `npx create-next-app@latest` → `next@16.2.6` + React 19 + Tailwind v4 + TypeScript + App Router + Turbopack; `npx shadcn@latest init -d` (Base Nova preset, slate-ish neutrals, `@base-ui/react`-backed primitives); added `button card badge input textarea`. Installed `convex` and pre-wired `convex/schema.ts` against the design's full data model (documents/sentences/practice_history/conversations/scenarios/words/review_log/daily_stats) — schema lives in git, actual deploy waits for first `npx convex dev` login.
- **Wrote 4 page shells under App Router.** `app/page.tsx` (今日目标 / 待复习 / 继续学习 3 cards), `app/learn/page.tsx` (9 hard-coded Menschen-B1-style sentences with per-sentence 🔍/🔊/✏️ buttons, inline expanding analyze + practice panels, double-click word → dictionary popover, `🔊` wired to `SpeechSynthesisUtterance` with `lang="de-DE"`), `app/chat/page.tsx` (chat layout with placeholder AI replies), `app/review/page.tsx` (full SM-2 review loop driven by `lib/srs.ts`).
- **Ported Lumina's SM-2 algorithm to `lib/srs.ts`** as pure functions, renamed fields to match our Convex `words` table (`ease`/`repetitions` vs Lumina's `easeFactor`/`reps`), preserved the four-rating model (`again`/`hard`/`good`/`easy`), dropped zod for runtime simplicity, exposed `calculateNextReview` + `intervalLabel` (preview labels on the rating buttons in `/review`) + `statusLabel` (CN mastery labels).
- **Iterated through 2 build failures**: (1) Turbopack ESM parser choked on un-escaped `"…"` quotes nested inside `"…"` strings — switched the offending German strings in `lib/sample-article.ts` and `app/chat/page.tsx` to template literals with `\u201E` / `\u201C` for the typographic quotes; (2) new shadcn Button (`@base-ui/react/button`) no longer accepts `asChild`, switched the two `<Button asChild><Link>…</Link></Button>` patterns in `app/page.tsx` to `<Link className={buttonVariants({...})}>…</Link>`.
- **Verified all 4 routes return HTTP 200** under `npm run dev` (Next 16 Turbopack, Ready in 6.7s). `npm run build` also passes — 5 static routes pre-rendered (`/`, `/_not-found`, `/chat`, `/learn`, `/review`).

### Files Changed
- `.cursor/rules/knowledge-capture.mdc`, `.cursor/rules/journal-workflow.mdc`, `scripts/journal-archive.ps1` — installed verbatim from `1yiwang/cursor-daily-workflow` template.
- `Project-Journal-Obsidian.md` — re-written from clean upstream template (mojibake-free) with `{{PROJECT_NAME}}` filled in as `german-coach`; this entry holds both the morning bootstrap and the afternoon v0.1 framework build.
- `package.json` + `package-lock.json` — `next@16.2.6`, `react@19.2.4`, `tailwindcss@4`, `convex`, `@base-ui/react` (via shadcn), `class-variance-authority`, `tw-animate-css`.
- `.gitignore` — Next.js defaults merged with the cursor-daily-workflow `.cursor/*` + `!.cursor/rules/**` pattern, plus `convex/_generated/`.
- `app/layout.tsx` — root layout with sticky header, 4-link nav (首页/精读/对话/复习), Geist sans/mono fonts, Chinese `lang="zh"`, footer.
- `app/page.tsx` — home with 3 status cards + v0.1 scope note. `buttonVariants`-wrapped `<Link>` instead of `Button asChild`.
- `app/learn/page.tsx` — sentence list with per-sentence inline panels (`analyze` / `practice`), word-level double-click dictionary popover anchored to bounding rect, browser TTS on 🔊.
- `app/chat/page.tsx` — chat UI shell with Enter-to-send textarea, AI/user message bubbles, placeholder AI reply that explicitly flags itself as v0.1.
- `app/review/page.tsx` — SM-2-driven review loop: show word → reveal definition + example → 4 rating buttons with interval previews (`< 1d` / `1d` / `4d` / etc.) computed live by `intervalLabel()`, `again` re-queues the card to the end of the deck, others advance.
- `app/globals.css` — shadcn-rewritten with oklch CSS variables + dark-mode block + `@theme inline` mapping.
- `lib/srs.ts` (new) — ported SM-2 algorithm + `WordStatus` enum + status/interval labels.
- `lib/sample-article.ts` (new) — 9 hand-crafted Menschen-B1-style sentences (Annas erster Tag im neuen Kurs) with grammar tags and Chinese translation hints.
- `lib/utils.ts` (shadcn-generated) — `cn()` tailwind-merge helper.
- `components/ui/{button,card,badge,input,textarea}.tsx` — shadcn Base Nova components.
- `convex/schema.ts` (new) — full schema for all 8 tables from `design.md` with `by_*` indexes (no actual deploy yet — file is committed, `npx convex dev` first-run will spin up the dev deployment).

### Architecture & Key Decisions
- **Lumina is a reference, not a dependency.** Lumina is React-Vite-Tauri (desktop) with SQLite + 8 AI providers + eye tracking + Japanese/Sanskrit toolkits. We're Next.js-on-Vercel + Convex + Claude-only. Algorithms and UX patterns port; infrastructure does not. Concretely: we lift `srsService.ts` line-by-line into `lib/srs.ts` (renaming fields, dropping zod, keeping the four-rating shape), but we **don't** copy `Reader.tsx` (68 KB monolith — our per-sentence-card UI is a cleaner fit for the design's "click to expand analyze/practice" interaction).
- **Pre-define the full Convex schema before any wiring.** Cheaper to refine `convex/schema.ts` while it's just a file than after a deploy with real data. v0.1 ships the schema; v0.2 turns it on. Same playbook used in `swiss-job-agent-web`.
- **shadcn Base Nova preset (the `@base-ui/react` backend)**, not the older Radix-based shadcn. This is shadcn's 2026 default — comes with `lib/utils.ts`, oklch CSS variables, `tw-animate-css`, and component primitives that **don't** support `asChild` (cost me one build iteration). Trade-off: more modern + better Tailwind 4 alignment vs. losing the `asChild` Slot pattern → use `buttonVariants` + `<Link className={...}>` instead, which is what the current shadcn docs recommend anyway.
- **Browser-native TTS (`SpeechSynthesisUtterance` with `lang="de-DE"`)** for v0.1 instead of ElevenLabs. Zero cost, ships today, every desktop browser has a German voice. ElevenLabs comes in v0.4 only if the native voice quality proves insufficient.
- **`next@16.2.6` instead of literally Next.js 15.** `create-next-app@latest` shipped 16.2.6 today (released within the last few weeks). All App-Router / Server Component APIs from 15 still work in 16; Turbopack is now default. Sticking with 16 unless something breaks.
- **No `core-standards.mdc` yet.** Now that we have a concrete tech stack (Next.js 16 + Convex + shadcn Base Nova + Claude + Tailwind 4), the next session is the right time to drop one in `.cursor/rules/` with paths and conventions — defer one more day so it can reference the actual file layout.

### Blockers
- None blocking. Two known soft issues: (1) `npx convex dev` requires an interactive Convex login the first time it runs — left for the human next session; (2) the LLM prompt strategy in `design.md` assumes Claude API access — no `CLAUDE_API_KEY` is wired yet, all LLM calls in the UI are placeholder text.

### Next
- **v0.2 (LLM wiring, ~1 day).** Wire Claude API in a `lib/llm.ts` server-side module. Hook the 🔍 / ✏️ buttons in `/learn` to real LLM calls using the prompt templates in `design.md` § "LLM 提示策略". Hook the dictionary popover to a `wordLookup` LLM call. Hook `/chat` to a streaming Claude chat with the "对话教练" system prompt.
- **v0.2 (Convex live).** Run `npx convex dev`, deploy `convex/schema.ts`, swap the seed arrays in `/review` and `/chat` for real Convex queries.
- **v0.2 (PDF upload).** `pdf-parse` + LLM-driven sentence segmentation → write `documents` + `sentences` rows. New `/archive` route to list uploaded PDFs.
- **Drop `.cursor/rules/core-standards.mdc`** with: project root layout (`app/` / `lib/` / `convex/` / `components/ui/`), tech-stack one-liner, the rule that `lib/srs.ts` is the **only** place that touches SM-2 (no inline ad-hoc scheduling math), pointer to `.cursor/rules/journal-workflow.mdc`.
- **File the upstream issue** on `1yiwang/cursor-daily-workflow` about the `install.ps1` UTF-8/CP936 mojibake — proposed fix is `[System.IO.File]::ReadAllText/WriteAllText` with an explicit `UTF8Encoding($false)` around the `{{PROJECT_NAME}}` substitution step.

### Notes for Librarian
- New project `german-coach` joins the `D:\Projects\` family (5th adopter of `cursor-daily-workflow`, alongside `swiss-job-agent-web` / `CV-site` / `permit-advisor` / `ai-builders-digest`).
- **Lumina-reuse summary table** (this is the answer to "你从 Lumina 学到了什么"):
  | Lumina feature/pattern | How we use it in german-coach | Direct copy or adapted? |
  |---|---|---|
  | SM-2 algorithm (`services/srsService.ts`) | Module C 复习算法 (`lib/srs.ts`) | **Direct copy** of the math; field rename (`easeFactor`→`ease`, `reps`→`repetitions`), zod dropped. Four-rating model preserved. |
  | Double-click on a word → side action | Module A 词典浮窗 (`app/learn/page.tsx`'s `DictionaryPopover`) | **Adapted.** Lumina double-click = save to vocab book. Ours = open LLM-driven popover with definition + "加入复习" CTA. |
  | Reader layout (`Reader.tsx`, 68 KB) | Module A 阅读页 (`app/learn/page.tsx`) | **Inspiration only.** Lumina is a single scrollable text with hover sidebar. Ours is a vertical stack of sentence-cards with per-sentence inline expand panels — fits the design's "解析就地展开" requirement better. |
  | `Term` data model (`types.ts` + `dataModels.ts`) | `convex/schema.ts` `words` table | **Adapted.** Same SRS fields (`interval`, `ease`, `repetitions`, `nextReview`, `lastReview`); our extras are `source` / `sourceRef` / `exampleSentence` for cross-module tracing (which PDF / chat session created this word). |
  | Multi-AI provider abstraction (`services/llmService.ts`, 31 KB) | Skipped for v0.1 | **No.** Single Claude API call site in v0.2; revisit only if we need provider diversity. |
  | Offline SQLite dictionary (`dict/de_dict.db`) | Skipped for v0.1 | **No.** LLM-as-dictionary is good enough at B1; revisit if latency or cost becomes painful. |
- **Concept notes worth creating in the Obsidian vault** (cross-project): `Spaced Repetition / SM-2 Algorithm` (links: lumina, german-coach), `shadcn Base Nova preset` (links: every Next.js project from 2026 onward), `Convex schema-first pattern` (links: swiss-job-agent-web, german-coach), `LLM-as-dictionary` (links: german-coach, anywhere we'd otherwise reach for a static dataset).

### New Concepts Discovered

| Concept | Where in code | Why it matters | One-line description |
|---------|--------------|----------------|---------------------|
| cursor-daily-workflow | `.cursor/rules/journal-workflow.mdc` | Project-agnostic daily-journal contract reusable across every repo, single contract file with Obsidian on the read side | A 4-file scaffold (`knowledge-capture.mdc`, `journal-workflow.mdc`, `journal-archive.ps1`, `Project-Journal-Obsidian.md`) that wires the Cursor agent into a fixed `today's plan: → log this → EOD → ship it → archive journal` trigger-phrase loop. |
| cp936-utf8-substitution-pitfall | `scripts/journal-archive.ps1` (upstream `install.ps1`) | Any PowerShell script that reads a UTF-8 file, does string replacement, and writes it back will corrupt non-ASCII characters when the host's default code page is GBK/CP936 unless encoding is pinned explicitly | Symptom seen here: em-dashes (`—`, UTF-8 `E2 80 94`) became `鈥?` (`E9 88 A5 3F`) — the bytes were round-tripped through CP936 during the `{{PROJECT_NAME}}` replace; fix is `[System.IO.File]::ReadAllText/WriteAllText` with an explicit `UTF8Encoding($false)`. |
| sm2-spaced-repetition | `lib/srs.ts` | Foundation of any long-term-memory learning app (Anki, SuperMemo, Lumina, German Coach, …); knowing the exact constants matters for tuning aggressiveness | Simplified SM-2: 4-rating user grading (`again`/`hard`/`good`/`easy`), `ease` floor of 1.3, first/second reps map to fixed intervals (1d/4d on success), then `interval *= ease` with rating-specific multipliers (`hard`→1.2, `good`→ease, `easy`→ease*1.3); `again` resets reps to 0 and `ease -= 0.2`. |
| shadcn-base-nova-preset | `components/ui/button.tsx`, `app/globals.css` | shadcn's 2026 default preset built on `@base-ui/react` instead of Radix; new projects scaffolded today get this automatically, and the `asChild` Slot pattern from older shadcn no longer works | `npx shadcn init -d` installs Base Nova: `@base-ui/react` primitives, oklch CSS variables, `tw-animate-css`, `font-heading` token. Use `buttonVariants({...})` + `<Link className={...}>` instead of `<Button asChild>`. |
| convex-schema-first | `convex/schema.ts` | Convex lets you commit a `schema.ts` that defines tables + indexes before ever deploying. Cheaper to refine while it's just a file than after a deploy with real data | The full v1.0 data model lives in `convex/schema.ts` from day one (8 tables: documents, sentences, practiceHistory, conversations, scenarios, words, reviewLog, dailyStats); `npx convex dev` first run will spin up the dev deployment and run the schema. |
| browser-native-tts-for-language-learning | `app/learn/page.tsx` (`speak()` function) | Zero-cost zero-latency German voice via `SpeechSynthesisUtterance` with `lang="de-DE"`, available in every modern browser on Windows/macOS/Linux. Defers ElevenLabs cost to v0.4-or-later | `new SpeechSynthesisUtterance(text); utter.lang = 'de-DE'; utter.rate = 0.9; window.speechSynthesis.speak(utter)`. Quality is "good enough for B1 listening practice" on stock Windows German voices. |

---
