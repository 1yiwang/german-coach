/**
 * Walk the per-page OCR output for the source PDF and pull out a structured
 * list of "Text" entries that should each become one /listen article.
 *
 * A Text page in Hueber's Deutsch Üben Hören & Sprechen B1 looks like:
 *
 *   [▶ 41]  3 a) Text und Lösung
 *
 *   Karla:     Guten Morgen!
 *   Hr. Weinz: Guten Morgen! Womit kann ich Ihnen helfen?
 *   ...
 *
 *   98   F  Geld und Geschäfte
 *
 * The ▶ glyph OCRs as ">" (sometimes "▶" or ">>" depending on the font),
 * giving us a regex-friendly track marker. The section header gives us
 * the Übung index (3) and the part (a / b / c) — only "a" parts are the
 * long dialog the user wants to import.
 *
 * Output:
 *   scripts/transcriptions/_parsed.json
 *     [{
 *       slug: "du-b1-track-41-f3-geld",
 *       trackNumber: 41,
 *       chapterLetter: "F",
 *       chapterTitle: "Geld und Geschäfte",
 *       übungNumber: 3,
 *       part: "a",
 *       title: "F 3 — ... (decided downstream)",
 *       pages: [100, 101],
 *       text: "Karla: Guten Morgen!\n..."
 *     }, …]
 *
 * Run:
 *   npx tsx scripts/dw-parse-ocr.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const baseDir = process.cwd();
const ocrDir = path.join(baseDir, "scripts", "transcriptions", "_ocr");
const outPath = path.join(
  baseDir,
  "scripts",
  "transcriptions",
  "_parsed.json",
);
const durationsPath = path.join(
  baseDir,
  "scripts",
  "transcriptions",
  "_audio-durations.json",
);

// Audio duration cache (seconds), keyed by zero-padded track number.
let audioDurations: Record<string, number> = {};
if (fs.existsSync(durationsPath)) {
  audioDurations = JSON.parse(fs.readFileSync(durationsPath, "utf-8"));
}

function trackDurationSec(trackNum: number): number {
  const tag = String(trackNum).padStart(2, "0");
  return audioDurations[tag] ?? 0;
}

// ---- Regex toolkit -------------------------------------------------------

// "▶ 41" / "> 41" / ">41" / ">>41" — the audio cue glyph + track number.
// We capture 1-3 chars (digits + common OCR substitutes ı/l/I→1, O/o→0)
// and normalise to digits before parsing. Post-processing fixes any
// remaining ambiguity using monotonicity + audio durations.
const TRACK_RE = /[>▶»]+\s*([\dıIlOo]{1,3})\b/;
function normaliseTrackDigits(raw: string): string {
  return raw
    .replace(/[ıIl]/g, "1")
    .replace(/[Oo]/g, "0");
}

// "3 a) Text" / "3a) Text und Lösung" / "1 a) Text" — section header.
const SECTION_RE = /\b(\d{1,2})\s*([a-c])\)\s*Text(?:\s+und\s+L[oö]sung)?/i;

// Page footer comes in two orientations alternating by odd/even page:
//   "12 A Leben und Liebe"     (even page: page-letter-title)
//   "Leben und Liebe A 17"     (odd page: title-letter-page)
// Hueber B1 has chapters A-H. We keep A-Z for safety.
const FOOTER_LEFT_RE = /^\s*(\d{1,3})\s+([A-Z])\s+(.+?)\s*$/;
const FOOTER_RIGHT_RE = /^\s*(.+?)\s+([A-Z])\.?\s+(\d{1,3})\s*$/;

// "Übung: Die erste Verabredung" — title appears on the QUESTION page of the
// same Übung, usually a few pages before the Text page.
const UEBUNG_TITLE_RE = /Übung[:\s]+(.+?)\s*$/i;

// ---- Per-page metadata ---------------------------------------------------

interface PageMeta {
  n: number;
  text: string;
  lines: string[];
  isTextPage: boolean;
  trackNumber?: number;
  übungNumber?: number;
  part?: "a" | "b" | "c";
  chapterLetter?: string;
  chapterTitle?: string;
  pageNumberPrinted?: number;
  bodyLines?: string[];
  headerLineIdx?: number;
  allHeaders?: TextHeaderHit[];
}

interface TextHeaderHit {
  pageN: number;
  lineIdx: number;
  trackRaw: string;
  trackNumber: number;
  übungNumber: number;
  part: "a" | "b" | "c";
}

function findAllTextHeaders(pageN: number, lines: string[]): TextHeaderHit[] {
  const hits: TextHeaderHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const window = lines.slice(i, i + 2).join(" ");
    const trackMatch = window.match(TRACK_RE);
    const secMatch = window.match(SECTION_RE);
    if (!trackMatch || !secMatch) continue;
    // Require both matches to be reasonably close so we don't pair a
    // ">12 1b)" track marker with a "1a) Text" header far below it.
    const trackPos = window.indexOf(trackMatch[0]);
    const secPos = window.indexOf(secMatch[0]);
    if (Math.abs(trackPos - secPos) > 30) continue;
    const trackDigits = normaliseTrackDigits(trackMatch[1]);
    if (!/^\d+$/.test(trackDigits)) continue;
    hits.push({
      pageN,
      lineIdx: i,
      trackRaw: trackMatch[1],
      trackNumber: correctTrackOcr(trackDigits),
      übungNumber: correctUebungOcr(secMatch[1], window),
      part: secMatch[2].toLowerCase() as "a" | "b" | "c",
    });
    // Skip the matched window to avoid re-matching on the same header line.
    i++;
  }
  return hits;
}

function classifyPage(n: number, raw: string): PageMeta {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n").map((l) => l.trim());
  const meta: PageMeta = { n, text, lines, isTextPage: false };
  const headers = findAllTextHeaders(n, lines);
  if (headers.length > 0) {
    meta.isTextPage = true;
    meta.trackNumber = headers[0].trackNumber;
    meta.übungNumber = headers[0].übungNumber;
    meta.part = headers[0].part;
    meta.headerLineIdx = headers[0].lineIdx;
    (meta as PageMeta & { allHeaders?: TextHeaderHit[] }).allHeaders = headers;
  }

  // Footer is on the last 1-3 non-empty lines. Try both orientations.
  const tail = [...lines].reverse().filter((l) => l.length > 0).slice(0, 3);
  for (const line of tail) {
    const left = line.match(FOOTER_LEFT_RE);
    if (left && Number(left[1]) > 4 && Number(left[1]) <= 250) {
      meta.pageNumberPrinted = Number(left[1]);
      meta.chapterLetter = left[2];
      meta.chapterTitle = left[3].trim();
      break;
    }
    const right = line.match(FOOTER_RIGHT_RE);
    if (right && Number(right[3]) > 4 && Number(right[3]) <= 250) {
      meta.pageNumberPrinted = Number(right[3]);
      meta.chapterLetter = right[2];
      meta.chapterTitle = right[1].trim();
      break;
    }
  }

  return meta;
}

// Each chapter (A-G) has at most ~5 Übungen, so a parsed value greater than
// MAX_UEBUNG_PER_CHAPTER almost certainly contains an OCR-added digit (e.g.
// the colored "C" block in the upper-right corner of a recto page reading
// as an extra "8"). We collapse to the first digit in that case.
function correctUebungOcr(raw: string, contextLine: string): number {
  const MAX_UEBUNG_PER_CHAPTER = 9;
  const n = Number(raw);
  if (n > 0 && n <= MAX_UEBUNG_PER_CHAPTER) return n;
  // Try collapsing 2-digit reading to first digit.
  if (raw.length >= 2) {
    const first = Number(raw[0]);
    if (first > 0 && first <= MAX_UEBUNG_PER_CHAPTER) {
      console.warn(
        `   ⚠ OCR Übung "${raw}" exceeds chapter max (${MAX_UEBUNG_PER_CHAPTER}),` +
          ` using first digit ${first}. context: ${contextLine
            .slice(0, 60)
            .trim()}`,
      );
      return first;
    }
  }
  return n;
}

// We know the book has 55 audio tracks. OCR sometimes doubles a digit
// (e.g. ">55" when the printed marker was actually "▶ 5"). We accept the raw
// value here and let the post-processing pass fix any outliers using
// monotonicity + audio durations across all detected Text pages.
function correctTrackOcr(rawDigits: string): number {
  return Number(rawDigits);
}

// NOTE: `stripFooter` / `stripHeader` helper candidates previously lived
// here, but they were never wired in (the text-layer parser in
// `dw-parse-pdf-text.ts` handles body extraction more reliably). Removed
// in R1 lint cleanup; reinstate from git history if a future OCR-only run
// needs them.

function joinBody(lines: string[]): string {
  // Tesseract breaks paragraphs into lines wherever the layout has a soft
  // wrap. For dialog format ("Karla: ...") we want to keep speaker lines
  // distinct but join wrapped lines onto the speaker line.
  const out: string[] = [];
  let buf = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    // New speaker line if it starts with a Word followed by ":"
    if (/^[A-ZÄÖÜ][\wäöüßÄÖÜ. ]{0,30}:\s/.test(line)) {
      if (buf) out.push(buf);
      buf = line;
    } else if (/^\d+\.\s/.test(line) || /^[-–•]\s/.test(line)) {
      // Numbered item or bullet — flush previous, start new para.
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf} ${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out.join("\n");
}

// ---- Übung title lookup --------------------------------------------------

function pickUebungTitle(
  prevPages: PageMeta[],
  übungNumber: number,
  chapterLetter: string,
): string | undefined {
  // Walk backwards until we find a "Übung: ..." line on a page from the same
  // chapter. The question page always precedes the text page.
  for (let i = prevPages.length - 1; i >= Math.max(0, prevPages.length - 8); i--) {
    const p = prevPages[i];
    if (p.chapterLetter && p.chapterLetter !== chapterLetter) break;
    for (const line of p.lines) {
      const m = line.match(UEBUNG_TITLE_RE);
      if (m && m[1].length > 3) {
        // Require the Übung number to match if it's visible nearby.
        const idx = p.lines.indexOf(line);
        const window = p.lines.slice(Math.max(0, idx - 3), idx + 3).join(" ");
        if (
          new RegExp(`\\b${übungNumber}\\b`).test(window) ||
          new RegExp(`\\b${chapterLetter}\\s*${übungNumber}\\b`).test(window)
        ) {
          return m[1]
            .replace(/[.…]+$/, "")
            .replace(/\s+/g, " ")
            .trim();
        }
        // Best-effort fallback: take the most recent Übung title regardless.
        return m[1]
          .replace(/[.…]+$/, "")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }
  return undefined;
}

// ---- Main ----------------------------------------------------------------

interface ParsedEntry {
  slug: string;
  trackNumber: number;
  chapterLetter: string;
  chapterTitle: string;
  übungNumber: number;
  part: "a" | "b" | "c";
  übungTitle?: string;
  title: string;
  pages: number[];
  text: string;
  wordCount: number;
}

function slugFor(entry: {
  trackNumber: number;
  chapterLetter: string;
  übungNumber: number;
  part: string;
}): string {
  return `du-b1-${String(entry.trackNumber).padStart(2, "0")}-${entry.chapterLetter.toLowerCase()}${entry.übungNumber}${entry.part}`;
}

function main() {
  if (!fs.existsSync(ocrDir)) {
    console.error(`❌ OCR dir not found: ${ocrDir}`);
    console.error(`   Run: npx tsx scripts/dw-pdf-extract.ts first.`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(ocrDir)
    .filter((f) => /^page-\d{3}\.txt$/.test(f))
    .sort();
  if (files.length === 0) {
    console.error(`❌ No OCR pages found in ${ocrDir}`);
    process.exit(1);
  }
  console.log(`📂 ${files.length} OCR'd pages`);

  // Pass 1: classify each page.
  const pages: PageMeta[] = files.map((f) => {
    const n = Number(f.match(/page-(\d+)\.txt/)![1]);
    const raw = fs.readFileSync(path.join(ocrDir, f), "utf-8");
    return classifyPage(n, raw);
  });

  // Pass 1.5: backfill missing chapter info on Text pages by looking at
  // pages immediately before/after. Chapters change monotonically (A→B→C…)
  // so neighbours are almost always the right answer. Prefer the chapter of
  // the previous page (Text pages are always in the same chapter as their
  // question page right before).
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.chapterLetter) continue;
    for (let r = 1; r <= 4; r++) {
      const before = pages[i - r];
      if (before?.chapterLetter) {
        p.chapterLetter = before.chapterLetter;
        if (!p.chapterTitle) p.chapterTitle = before.chapterTitle ?? "";
        break;
      }
      const after = pages[i + r];
      if (after?.chapterLetter) {
        p.chapterLetter = after.chapterLetter;
        if (!p.chapterTitle) p.chapterTitle = after.chapterTitle ?? "";
        break;
      }
    }
  }

  // Pass 2: flatten ALL Text headers into a single ordered list. Each entry
  // is bounded by [this header, next header). The body may span multiple
  // pages OR end mid-page (when the next header is on the same page, e.g.
  // page 11 contains A1a Lösung + A1b Text on the same physical sheet).
  const flatHeaders: TextHeaderHit[] = [];
  for (const p of pages) {
    if (p.allHeaders) flatHeaders.push(...p.allHeaders);
  }
  const pageByNum = new Map(pages.map((p) => [p.n, p]));

  const entries: ParsedEntry[] = [];
  for (let hi = 0; hi < flatHeaders.length; hi++) {
    const start = flatHeaders[hi];
    const end = flatHeaders[hi + 1];

    const blockPages: PageMeta[] = [];
    const blockLines: string[] = [];
    const lastPageN = end ? end.pageN : pages.at(-1)!.n;
    for (let pn = start.pageN; pn <= lastPageN; pn++) {
      const p = pageByNum.get(pn);
      if (!p) continue;
      blockPages.push(p);
      // Walk this page's lines and pick the slice for this entry.
      const firstLine =
        pn === start.pageN ? start.lineIdx + 1 : 0;
      const lastLine =
        end && pn === end.pageN ? end.lineIdx : p.lines.length;
      const slice = p.lines.slice(firstLine, lastLine);
      // Drop footer lines that belong to this page (not the entry).
      const cleaned = dropFooterFromSlice(slice);
      blockLines.push(...cleaned);
    }

    const text = joinBody(blockLines);
    const chapterLetter =
      blockPages.find((p) => p.chapterLetter)?.chapterLetter ?? "?";
    const chapterTitle =
      blockPages.find((p) => p.chapterTitle)?.chapterTitle ?? "";
    const übungTitle = pickUebungTitle(
      pages.slice(
        0,
        pages.findIndex((p) => p.n === start.pageN),
      ),
      start.übungNumber,
      chapterLetter,
    );
    const slug = slugFor({
      trackNumber: start.trackNumber,
      chapterLetter,
      übungNumber: start.übungNumber,
      part: start.part,
    });
    const titleBase = übungTitle ?? `Übung ${start.übungNumber}${start.part}`;
    const title = `${chapterLetter}${start.übungNumber}${start.part} ${titleBase}`.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    entries.push({
      slug,
      trackNumber: start.trackNumber,
      chapterLetter,
      chapterTitle,
      übungNumber: start.übungNumber,
      part: start.part,
      übungTitle,
      title,
      pages: blockPages.map((p) => p.n),
      text,
      wordCount,
    });
  }

  function dropFooterFromSlice(slice: string[]): string[] {
    const out = [...slice];
    while (out.length > 0) {
      const last = out[out.length - 1].trim();
      if (!last) {
        out.pop();
        continue;
      }
      if (FOOTER_LEFT_RE.test(last) || FOOTER_RIGHT_RE.test(last)) {
        out.pop();
        continue;
      }
      if (/^[A-Z]$/.test(last)) {
        out.pop();
        continue;
      }
      break;
    }
    return out;
  }

  // Pass 3: track-number fixup using audio duration + monotonic order.
  // Each long-dialog (a part) Text page MUST map to a real audio track. We
  // estimate the expected audio duration from the OCR'd word count (German
  // speech ~150 wpm), then for each entry score all candidate track numbers
  // by (a) monotonic compatibility and (b) closeness of audio duration to
  // the estimate. Picks the highest-scoring valid candidate.
  //
  // Candidate generation per entry: { raw, raw-leading-digits, raw-trailing-digits,
  // raw concatenated with next entry's leading digit }. We don't enumerate
  // exhaustively — just the 4 OCR error shapes we've seen in practice.
  const wordsPerSec = 150 / 60;
  function candidatesFor(e: ParsedEntry): number[] {
    const s = String(e.trackNumber);
    const out = new Set<number>();
    out.add(e.trackNumber);
    if (s.length >= 2) {
      out.add(Number(s.slice(1)));
      out.add(Number(s.slice(0, -1)));
    }
    // OCR-split error: the printed marker "▶ 43  4 a)" gets sliced by
    // Tesseract into "3" + "4a)" (or "4" + "3a)"). Try both orderings of
    // the single-digit track and the section's Übung digit.
    if (s.length === 1 && e.übungNumber < 10) {
      out.add(Number(`${s}${e.übungNumber}`));
      out.add(Number(`${e.übungNumber}${s}`));
    }
    return Array.from(out).filter(
      (c) => Number.isInteger(c) && c > 0 && c <= 55,
    );
  }
  function scoreTrack(cand: number, e: ParsedEntry, prev: number): number {
    if (cand <= prev) return -Infinity;
    const dur = trackDurationSec(cand);
    if (!dur) return -Infinity;
    // Long-dialog (a) tracks should be >= 90 seconds. Short b/c exercise
    // tracks have no minimum.
    if (e.part === "a" && dur < 90) return -Infinity;
    const expectedSec = e.wordCount / wordsPerSec;
    return Math.min(dur, expectedSec) / Math.max(dur, expectedSec);
  }
  // Patch strategy depends on the part:
  //   a) parts are long monologues/dialogs — duration is a strong signal,
  //      apply duration scoring (only patch when a candidate is clearly
  //      better).
  //   b/c parts are exercises whose audio length is dominated by pauses,
  //      so duration ≠ word count. Trust raw OCR; only fix if raw is
  //      monotonically invalid (then prefer the smallest > prev candidate).
  let prev = 0;
  for (const e of entries) {
    const isLong = e.part === "a";
    const cands = candidatesFor(e);
    const rawInRange =
      e.trackNumber > prev && e.trackNumber > 0 && e.trackNumber <= 55;

    if (isLong) {
      const rawScore = scoreTrack(e.trackNumber, e, prev);
      if (rawScore > 0.7) {
        prev = e.trackNumber;
        continue;
      }
      const scored = cands
        .map((c) => ({ c, s: scoreTrack(c, e, prev) }))
        .filter((x) => x.s > -Infinity)
        .sort((a, b) => b.s - a.s || a.c - b.c);
      if (scored.length > 0 && scored[0].s > rawScore + 0.05) {
        const fixed = scored[0].c;
        console.warn(
          `   ⚠ Track ${e.trackNumber} ("${e.title}") patched to ${fixed}` +
            ` (audio ${trackDurationSec(fixed).toFixed(0)}s,` +
            ` expected ~${(e.wordCount / wordsPerSec).toFixed(0)}s,` +
            ` raw-score ${rawScore.toFixed(2)} → new ${scored[0].s.toFixed(2)},` +
            ` candidates: ${cands.join("/")})`,
        );
        e.trackNumber = fixed;
        e.slug = slugFor({
          trackNumber: fixed,
          chapterLetter: e.chapterLetter,
          übungNumber: e.übungNumber,
          part: e.part,
        });
        prev = fixed;
      } else if (rawInRange) {
        prev = e.trackNumber;
      } else {
        console.warn(
          `   ⚠ Track ${e.trackNumber} ("${e.title}") could not be fixed.` +
            ` cands=${cands.join("/")}, prev=${prev}, raw-score=${rawScore.toFixed(2)}` +
            ` — MANUAL REVIEW NEEDED`,
        );
        prev = e.trackNumber;
      }
    } else {
      // b/c exercise — monotonic fix only.
      if (rawInRange) {
        prev = e.trackNumber;
        continue;
      }
      const valid = cands
        .filter((c) => c > prev && c <= 55)
        .sort((a, b) => a - b);
      if (valid.length > 0) {
        const fixed = valid[0];
        console.warn(
          `   ⚠ Track ${e.trackNumber} ("${e.title}") monotonic-patched` +
            ` to ${fixed} (cands ${cands.join("/")}, prev=${prev})`,
        );
        e.trackNumber = fixed;
        e.slug = slugFor({
          trackNumber: fixed,
          chapterLetter: e.chapterLetter,
          übungNumber: e.übungNumber,
          part: e.part,
        });
        prev = fixed;
      } else {
        console.warn(
          `   ⚠ Track ${e.trackNumber} ("${e.title}") b/c part could not be fixed.` +
            ` cands=${cands.join("/")}, prev=${prev} — MANUAL REVIEW NEEDED`,
        );
        prev = e.trackNumber;
      }
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf-8");
  console.log(`\n✅ Wrote ${entries.length} entries → ${outPath}`);

  // Summary table
  console.log(`\nSummary by part:`);
  const byPart = entries.reduce(
    (acc, e) => {
      acc[e.part] = (acc[e.part] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  for (const [k, v] of Object.entries(byPart)) console.log(`  ${k}) → ${v}`);

  console.log(`\nLong-dialog (a) entries — the ones to import:`);
  for (const e of entries.filter((e) => e.part === "a")) {
    console.log(
      `  Track ${String(e.trackNumber).padStart(2)}  ${e.chapterLetter}${e.übungNumber}${e.part}  ${e.wordCount} words  pp${e.pages.join("-")}  "${e.title}"`,
    );
  }

  const allParts = entries.length;
  const aOnly = entries.filter((e) => e.part === "a").length;
  console.log(
    `\n→ ${allParts} total Text sections, ${aOnly} long dialogs (a parts).`,
  );
}

main();
