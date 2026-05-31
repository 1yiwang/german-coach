/**
 * Parse Hueber Deutsch üben Hören & Sprechen B1 directly from a text-layer PDF.
 *
 * This replaces the OCR path when the PDF contains selectable text. It writes
 * the same scripts/transcriptions/_parsed.json shape consumed by
 * dw-batch-import.ts.
 *
 * Run:
 *   npx tsx scripts/dw-parse-pdf-text.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const baseDir = process.cwd();
const pdfPath = path.join(baseDir, "scripts", "B1 listening.pdf");
const outDir = path.join(baseDir, "scripts", "transcriptions");
const pagesCachePath = path.join(outDir, "_pdftext-pages.json");
const outPath = path.join(outDir, "_parsed.json");

interface PdfPage {
  num: number;
  text: string;
}

interface TocEntry {
  chapterLetter: string;
  chapterTitle: string;
  übungNumber: number;
  übungTitle: string;
  printedPage: number;
  tracks: number[];
}

interface PageMeta {
  n: number;
  text: string;
  lines: string[];
  chapterLetter?: string;
  chapterTitle?: string;
  printedPage?: number;
}

interface TextHeader {
  pageN: number;
  lineIdx: number;
  chapterLetter: string;
  chapterTitle: string;
  übungNumber: number;
  part: "a" | "b" | "c";
}

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

const SECTION_TEXT_RE =
  /^(\d{1,2})\s*([a-c])\)\s*Text(?:\s+und\s+L[oö]sung)?\s*$/i;
const SECTION_ANY_RE =
  /^(\d{1,2})\s*([a-c])\)\s*(?:Text|L[oö]sung|Jetzt|H[oö]ren)\b/i;
const FOOTER_LEFT_RE = /^\s*(\d{1,3})\s+([A-H])\s+(.+?)\s*$/;
const FOOTER_RIGHT_RE = /^\s*(\d{1,3})\s+(.+?)\s+([A-H])\.?\s*$/;

function cleanLine(raw: string): string {
  return raw
    .replace(/\u0002/g, "")
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(cleanLine);
}

function expandTrackRange(raw: string): number[] {
  const m = raw.trim().match(/^(\d+)(?:[–-](\d+))?$/);
  if (!m) return [];
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function stripDotLeaders(title: string): string {
  return title.replace(/\s*(?:\. ?){2,}.*$/, "").replace(/\s+/g, " ").trim();
}

function parseToc(pages: PdfPage[]): TocEntry[] {
  const tocPages = pages.filter((p) => p.num === 5 || p.num === 6);
  const rows: Omit<TocEntry, "tracks">[] = [];
  const ranges: number[][] = [];
  let currentChapter: { letter: string; title: string } | null = null;

  for (const page of tocPages) {
    for (const line of splitLines(page.text)) {
      if (!line || line === "Übung" || line === "Inhalt") continue;

      const range = line.match(/^\d+(?:[–-]\d+)?$/);
      if (range) {
        ranges.push(expandTrackRange(line));
        continue;
      }

      const chapter = line.match(/^([A-H])\s+(.+?)\s+(\d{1,3})$/);
      if (chapter) {
        currentChapter = {
          letter: chapter[1],
          title: stripDotLeaders(chapter[2]),
        };
        continue;
      }

      const exercise = line.match(/^(\d{1,2})\s+(.+?)\s+(\d{1,3})$/);
      if (exercise && currentChapter) {
        rows.push({
          chapterLetter: currentChapter.letter,
          chapterTitle: currentChapter.title,
          übungNumber: Number(exercise[1]),
          übungTitle: stripDotLeaders(exercise[2]),
          printedPage: Number(exercise[3]),
        });
      }
    }
  }

  // The first track range in the TOC is "1" for Vorwort/Einleitung, not an
  // exercise. Drop it when pairing exercise rows to exercise track ranges.
  const exerciseRanges =
    ranges.length === rows.length + 1 && ranges[0].length === 1 && ranges[0][0] === 1
      ? ranges.slice(1)
      : ranges;

  if (rows.length !== exerciseRanges.length) {
    throw new Error(
      `TOC parse mismatch: ${rows.length} exercises but ${exerciseRanges.length} track ranges`,
    );
  }

  return rows.map((row, i) => ({ ...row, tracks: exerciseRanges[i] }));
}

function classifyPage(page: PdfPage, previous?: PageMeta): PageMeta {
  const lines = splitLines(page.text);
  const meta: PageMeta = { n: page.num, text: page.text, lines };

  for (const line of [...lines.slice(0, 4), ...lines.slice(-4)]) {
    const left = line.match(FOOTER_LEFT_RE);
    if (left && Number(left[1]) > 4 && Number(left[1]) <= 250) {
      meta.printedPage = Number(left[1]);
      meta.chapterLetter = left[2];
      meta.chapterTitle = left[3];
      break;
    }
    const right = line.match(FOOTER_RIGHT_RE);
    if (right && Number(right[1]) > 4 && Number(right[1]) <= 250) {
      meta.printedPage = Number(right[1]);
      meta.chapterLetter = right[3];
      meta.chapterTitle = right[2];
      break;
    }
  }

  if (!meta.chapterLetter && previous?.chapterLetter) {
    meta.chapterLetter = previous.chapterLetter;
    meta.chapterTitle = previous.chapterTitle;
  }

  return meta;
}

function slugFor(entry: {
  trackNumber: number;
  chapterLetter: string;
  übungNumber: number;
  part: string;
}): string {
  return `du-b1-${String(entry.trackNumber).padStart(2, "0")}-${entry.chapterLetter.toLowerCase()}${entry.übungNumber}${entry.part}`;
}

function trackForPart(toc: TocEntry, part: "a" | "b" | "c"): number {
  const idx = part.charCodeAt(0) - "a".charCodeAt(0);
  return toc.tracks[idx] ?? toc.tracks[0] + idx;
}

function isPageFurniture(line: string): boolean {
  if (!line) return true;
  if (/^[A-H]$/.test(line)) return true;
  if (/^\d{1,2}$/.test(line)) return true; // printed track marker near footer
  if (FOOTER_LEFT_RE.test(line) || FOOTER_RIGHT_RE.test(line)) return true;
  return false;
}

function isBoundaryLine(line: string): boolean {
  return SECTION_ANY_RE.test(line) || /^[A-H].*Übung:\s+/.test(line);
}

function joinBody(lines: string[]): string {
  const out: string[] = [];
  let buf = "";

  for (const raw of lines) {
    const line = cleanLine(raw);
    if (isPageFurniture(line)) continue;

    if (/^[A-ZÄÖÜ][\wäöüßÄÖÜ. ]{0,30}:\s*/.test(line)) {
      if (buf) out.push(buf);
      buf = line;
    } else if (/^\d+\.\s/.test(line) || /^[-–•]\s/.test(line)) {
      if (buf) out.push(buf);
      buf = line;
    } else if (!buf) {
      buf = line;
    } else if (/-$/.test(buf) && /^[a-zäöüß]/.test(line)) {
      buf = `${buf.slice(0, -1)}${line}`;
    } else {
      buf = `${buf} ${line}`;
    }
  }

  if (buf) out.push(buf);
  return out.join("\n").trim();
}

async function loadPages(): Promise<PdfPage[]> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
  });
  const result = await parser.getText();
  await parser.destroy();

  const pages = result.pages.map((p) => ({
    num: p.num,
    text: p.text,
  }));
  fs.writeFileSync(pagesCachePath, JSON.stringify(pages, null, 2), "utf-8");
  return pages;
}

async function main() {
  const pdfPages = await loadPages();
  const toc = parseToc(pdfPages);
  const tocByExercise = new Map(
    toc.map((e) => [`${e.chapterLetter}${e.übungNumber}`, e]),
  );

  const pages: PageMeta[] = [];
  for (const page of pdfPages) {
    pages.push(classifyPage(page, pages.at(-1)));
  }
  const pageByNum = new Map(pages.map((p) => [p.n, p]));

  const headers: TextHeader[] = [];
  for (const page of pages) {
    if (!page.chapterLetter) continue;
    for (let i = 0; i < page.lines.length; i++) {
      const match = page.lines[i].match(SECTION_TEXT_RE);
      if (!match) continue;
      headers.push({
        pageN: page.n,
        lineIdx: i,
        chapterLetter: page.chapterLetter,
        chapterTitle: page.chapterTitle ?? "",
        übungNumber: Number(match[1]),
        part: match[2].toLowerCase() as "a" | "b" | "c",
      });
    }
  }

  const entries: ParsedEntry[] = [];
  for (let hi = 0; hi < headers.length; hi++) {
    const start = headers[hi];
    const nextTextHeader = headers[hi + 1];
    const blockPages: PageMeta[] = [];
    const blockLines: string[] = [];
    let done = false;
    const lastPageN = nextTextHeader?.pageN ?? pages.at(-1)!.n;

    for (let pn = start.pageN; pn <= lastPageN && !done; pn++) {
      const page = pageByNum.get(pn);
      if (!page) continue;
      blockPages.push(page);
      const from = pn === start.pageN ? start.lineIdx + 1 : 0;
      const hardStop =
        nextTextHeader && pn === nextTextHeader.pageN
          ? nextTextHeader.lineIdx
          : page.lines.length;

      for (let i = from; i < hardStop; i++) {
        const line = page.lines[i];
        if (isBoundaryLine(line)) {
          done = true;
          break;
        }
        blockLines.push(line);
      }
    }

    const tocEntry = tocByExercise.get(`${start.chapterLetter}${start.übungNumber}`);
    if (!tocEntry) {
      console.warn(
        `⚠ No TOC entry for ${start.chapterLetter}${start.übungNumber}${start.part}; skipping`,
      );
      continue;
    }

    const trackNumber = trackForPart(tocEntry, start.part);
    const text = joinBody(blockLines);
    const title = `${start.chapterLetter}${start.übungNumber}${start.part} ${tocEntry.übungTitle}`.trim();
    entries.push({
      slug: slugFor({
        trackNumber,
        chapterLetter: start.chapterLetter,
        übungNumber: start.übungNumber,
        part: start.part,
      }),
      trackNumber,
      chapterLetter: start.chapterLetter,
      chapterTitle: tocEntry.chapterTitle || start.chapterTitle,
      übungNumber: start.übungNumber,
      part: start.part,
      übungTitle: tocEntry.übungTitle,
      title,
      pages: Array.from(new Set(blockPages.map((p) => p.n))),
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    });
  }

  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf-8");

  console.log(`📄 PDF pages: ${pdfPages.length}`);
  console.log(`📚 TOC exercises: ${toc.length}`);
  console.log(`✅ Wrote ${entries.length} entries → ${outPath}`);
  console.log(`\nLong-dialog (a) entries — the ones to import:`);
  for (const e of entries.filter((e) => e.part === "a")) {
    console.log(
      `  Track ${String(e.trackNumber).padStart(2, "0")}  ${e.chapterLetter}${e.übungNumber}${e.part}  ${e.wordCount} words  pp${e.pages.join("-")}  "${e.title}"`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
