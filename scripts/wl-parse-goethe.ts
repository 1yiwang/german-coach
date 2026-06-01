/**
 * Goethe-Zertifikat B1 Wortliste PDF → structured JSON parser.
 *
 * Uses pdfjs-dist for text-item coordinates. Within each page column,
 * 2-means clustering on x-coordinates automatically separates headword
 * entries (left-cluster) from example sentences (right-cluster).
 * Items are then walked top-to-bottom and paired by y-proximity.
 *
 * Run:
 *   npx tsx scripts/wl-parse-goethe.ts
 *
 * Output:
 *   scripts/transcriptions/_wortliste-b1.json (~2400 entries)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────────────

interface TextItem {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

interface WordEntry {
  headword: string;
  pos: string;
  inflection: string;
  examples: string[];
  topic: string | null;
  regional: string | null;
}

// ── Constants ──────────────────────────────────────────────────────

const SECTION_START_PAGE = 16;
const COLUMN_GAP_X = 230; // separates left/right page columns

// ── 2-Means X-Split ────────────────────────────────────────────────

/** Find the natural x-boundary between headwords (left) and examples (right)
 *  by locating the widest gap in the sorted x-distribution.
 *  Constrained to the middle 60% of the range to avoid outlier gaps. */
function findXSplit(items: TextItem[]): number {
  const xs = items.map((i) => i.x);
  if (xs.length < 4) return xs[0] ?? 0;

  const sorted = [...xs].sort((a, b) => a - b);

  // Constrain search to middle 60% of the range
  const lo = sorted[Math.floor(sorted.length * 0.2)];
  const hi = sorted[Math.ceil(sorted.length * 0.8) - 1];

  // Find the widest gap between consecutive x-values in the constrained range
  let bestGap = 0;
  let gapMid = (sorted[0] + sorted[sorted.length - 1]) / 2;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    // Only consider gaps within the constrained range
    if (a < lo || b > hi) continue;
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      gapMid = (a + b) / 2;
    }
  }

  return gapMid;
}

// ── POS Detection ──────────────────────────────────────────────────

interface POSResult {
  headword: string;
  pos: string;
  inflection: string;
  regional: string | null;
}

function detectPOS(entryText: string): POSResult {
  const cleaned = entryText.replace(/\s+/g, " ").trim();
  if (!cleaned) return { headword: "", pos: "unknown", inflection: "", regional: null };

  // Extract regional variant: (D), (A), (CH), (D, A), etc.
  const regionalMatch = cleaned.match(/\(((?:D|A|CH)(?:,\s*(?:D|A|CH))*)\)\s*$/);
  const regional = regionalMatch ? regionalMatch[1] : null;
  let text = cleaned.replace(/\s*\((?:D|A|CH)(?:,\s*(?:D|A|CH))*\)\s*$/, "").trim();

  // Strip trailing → references
  text = text.replace(/\s*→\s*[A-Za-zÄÖÜäöüß,:\s-]+$/, "").trim();

  // Noun: der/die/das X, (plural/declension)
  const nounMatch = text.match(/^(der|die|das)\s+(\S+?)(?:,?\s+(.+))?$/);
  if (nounMatch) {
    const article = nounMatch[1];
    const gender = article === "der" ? "m" : article === "die" ? "f" : "n";
    const hw = nounMatch[2].replace(/[,;]$/, "").replace(/^["„]/, "").replace(/["»]$/, "");
    return { headword: hw, pos: `noun:${gender}`, inflection: text, regional };
  }

  // Reflexive: sich ärgern, ärgert, ärgerte, hat geärgert
  const reflMatch = text.match(/^sich\s+(\S+?),?\s*(.*)$/);
  if (reflMatch) {
    return { headword: reflMatch[1].replace(/,$/, ""), pos: "verb:refl", inflection: text, regional };
  }

  // Verb with conjugation pattern (3+ comma parts, last part starts with hat/ist)
  const parts = text.split(",").map((s) => s.trim());
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    if (/^(hat|ist)\s/.test(last) || /\bge\w{2,}\s*$/.test(last)) {
      return { headword: parts[0], pos: "verb", inflection: parts.slice(1).join(", "), regional };
    }
  }

  // Adjective with comparative/superlative: "gut, besser, best-"
  if (/^[a-zäöüß]+,/.test(text)) {
    const p = text.split(",");
    const hw = p[0].trim();
    const rest = p.slice(1).join(", ").trim();
    // Check if it looks like adj inflection vs verb conjugation
    if (!/^(hat|ist)\s/.test(rest) && !/\bge\w{2,}$/.test(rest)) {
      return { headword: hw, pos: "adj", inflection: rest, regional };
    }
  }

  // Single lowercase word
  if (/^[a-zäöüß][a-zäöüß-]*$/.test(text)) {
    return { headword: text, pos: guessWordPOS(text), inflection: "", regional };
  }

  // Multi-word expression starting with lowercase
  if (/^[a-zäöüß]/.test(text) && text.includes(" ")) {
    const firstWord = text.split(/[\s,(]/)[0].trim();
    return { headword: firstWord, pos: guessWordPOS(firstWord), inflection: text, regional };
  }

  // Fallback
  const firstWord = text.split(/[,\s(]/)[0].trim();
  return { headword: firstWord || text, pos: "unknown", inflection: text, regional };
}

function guessWordPOS(word: string): string {
  const preps = new Set([
    "ab", "an", "auf", "aus", "bei", "bis", "durch", "für", "gegen",
    "hinter", "in", "mit", "nach", "neben", "ohne", "über", "um",
    "unter", "von", "vor", "zu", "zwischen", "außer", "seit", "während",
    "wegen", "trotz", "entlang", "abwärts", "aufwärts", "innerhalb",
    "außerhalb", "anstatt", "statt", "kraft", "laut", "mithilfe",
    "kraft", "mangels", "mittels", "zwecks", "anhand", "anlässlich",
  ]);
  if (preps.has(word)) return "prep";

  const conjs = new Set([
    "aber", "als", "also", "weil", "dass", "denn", "doch", "und",
    "oder", "sondern", "wenn", "ob", "sowie", "sowohl", "außerdem",
    "beziehungsweise", "deshalb", "jedoch", "nämlich", "trotzdem",
    "weder", "entweder", "damit", "sobald", "solange", "sofern",
    "sooft", "soweit", "indem", "indessen", "nachdem", "obwohl",
    "obgleich", "seitdem", "während", "wobei",
  ]);
  if (conjs.has(word)) return "conj";

  const advs = new Set([
    "auch", "bald", "beinahe", "bereits", "besonders", "damals",
    "danach", "dann", "deshalb", "dort", "drinnen", "draußen",
    "einmal", "fast", "früher", "genauso", "gerne", "gestern",
    "heute", "hier", "immer", "jetzt", "leider", "morgen",
    "nachts", "natürlich", "nie", "noch", "oben", "schon",
    "sehr", "so", "trotzdem", "unten", "vielleicht", "wirklich",
    "ziemlich", "zusammen", "davon", "dazu", "dabei", "daher",
    "dahin", "damit", "daneben", "darauf", "daraus", "darin",
    "darüber", "darum", "darunter", "davon", "davor", "dagegen",
    "daheim", "daran", "dazwischen", "überall", "überhaupt",
    "außerdem", "allerdings", "inzwischen", "mittlerweile",
    "neulich", "sofort", "vorbei", "vorher", "weg", "zurück",
  ]);
  if (advs.has(word)) return "adv";

  // Adjective suffixes
  if (
    word.endsWith("ig") || word.endsWith("lich") || word.endsWith("isch") ||
    word.endsWith("bar") || word.endsWith("sam") || word.endsWith("los") ||
    word.endsWith("haft") || word.endsWith("arm") || word.endsWith("voll") ||
    word.endsWith("frei") || word.endsWith("reich") || word.endsWith("wert") ||
    word.endsWith("würdig") || word.endsWith("mäßig") || word.endsWith("al") ||
    word.endsWith("ell")
  ) {
    return "adj";
  }

  // Typical verb endings
  if ((word.endsWith("en") || word.endsWith("eln") || word.endsWith("ern")) && word.length > 4) {
    return "verb";
  }

  return "other";
}

// ── Column Parser ──────────────────────────────────────────────────

interface RawEntry {
  headwordLines: string[];
  exampleLines: string[];
  yMin: number;
}

function parseColumn(items: TextItem[]): RawEntry[] {
  if (items.length < 3) return [];

  // K-means split between headword and example x-positions
  const hwThreshold = findXSplit(items);

  // Separate items
  const hwItems = items.filter((i) => i.x < hwThreshold);
  const exItems = items.filter((i) => i.x >= hwThreshold);

  // Sort by y DESCENDING: in PDF coordinates, higher y = higher on page = top
  hwItems.sort((a, b) => b.y - a.y);
  exItems.sort((a, b) => b.y - a.y);

  // Group headword items into entries by y-gap
  const rawEntries: RawEntry[] = [];
  let currentLines: string[] = [];
  let currentYMin = 0;
  let prevY = -100;

  for (const item of hwItems) {
    const gap = item.y - prevY;

    // A gap > 18px signals a new entry (or new section letter)
    if (currentLines.length > 0 && Math.abs(gap) > 18) {
      rawEntries.push({
        headwordLines: [...currentLines],
        exampleLines: [],
        yMin: currentYMin,
      });
      currentLines = [];
    }

    if (currentLines.length === 0) {
      currentYMin = item.y;
    }
    currentLines.push(item.text);
    prevY = item.y;
  }
  if (currentLines.length > 0) {
    rawEntries.push({
      headwordLines: [...currentLines],
      exampleLines: [],
      yMin: currentYMin,
    });
  }

  // Assign example items to entries by y-proximity.
  // Each example goes to the closest entry that is ABOVE it (or at most
  // 15px below — some examples sit a few px above their headword line).
  // This prevents entries from stealing examples that belong to an entry
  // far above them (the "above" constraint is critical).
  const EX_TOLERANCE = 15;
  for (const exItem of exItems) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < rawEntries.length; i++) {
      const entryY = rawEntries[i].yMin;
      // Entry must be above the example (or slightly below, up to tolerance)
      if (entryY >= exItem.y - EX_TOLERANCE) {
        const dist = Math.abs(entryY - exItem.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
    }

    if (bestIdx >= 0) {
      rawEntries[bestIdx].exampleLines.push(exItem.text);
    }
  }

  return rawEntries;
}

// ── Clean up ───────────────────────────────────────────────────────

/** Is this line a section letter, cross-ref, or other non-entry text? */
function isBadEntryText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length <= 1) return true;
  // Section letters
  if (/^[A-ZÄÖÜ]$/.test(t)) return true;
  // Continuation suffixes
  if (/^-[a-zäöüß]+$/.test(t)) return true;
  // Regional markers alone
  if (/^\([A-Za-z,\s]+\)$/.test(t)) return true;
  // Cross-ref arrows
  if (t.startsWith("→")) return true;
  if (t === "→") return true;
  // Regional label lines
  if (/^[A-ZÄÖÜ]:/.test(t) && t.length < 6) return true;
  // Pure numbers
  if (/^\d+$/.test(t)) return true;
  // Dashed continuation like "-nen" that's part of another entry
  if (/^-\w+$/.test(t)) return true;
  return false;
}

/** Build example sentences from raw lines */
function buildExamples(lines: string[]): string[] {
  if (lines.length === 0) return [];

  // Lines are already sorted by the order they were assigned
  const examples: string[] = [];
  let current = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // New numbered example
    if (/^\d+\.\s/.test(trimmed)) {
      if (current) examples.push(current.trim());
      current = trimmed;
    } else if (current) {
      current += " " + trimmed;
    } else {
      current = trimmed;
    }
  }
  if (current) examples.push(current.trim());

  // Filter out lines that look like cross-references or debris
  const clean = examples
    .filter((e) => e.length > 5)
    .filter((e) => !/^→/.test(e))
    .filter((e) => !/^[A-ZÄÖÜ]:/.test(e))
    .filter((e) => e.length > 10 || /[a-zäöüß]{3,}/.test(e));

  if (clean.length === 0 && examples.length > 0) {
    // Try joining all lines as a single example
    const joined = lines.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length > 10) return [joined];
  }

  return clean;
}

/** Convert RawEntry → WordEntry, filtering bad ones */
function rawToEntry(raw: RawEntry): WordEntry | null {
  // Skip entries that are section letters
  if (raw.headwordLines.length === 1 && isBadEntryText(raw.headwordLines[0])) {
    return null;
  }

  const entryText = raw.headwordLines.join(" ").replace(/\s+/g, " ").trim();

  // Skip if the combined text is bad
  if (isBadEntryText(entryText)) return null;
  if (entryText.length < 2) return null;

  // Skip entries where headword starts with parenthesis or dash
  if (/^[(\-]/.test(entryText)) return null;
  if (/^[A-ZÄÖÜ]:/.test(entryText)) return null;
  if (entryText.startsWith("→")) return null;

  const examples = buildExamples(raw.exampleLines);
  const pos = detectPOS(entryText);

  // Don't output entries with nonsensical headwords
  if (pos.headword.length < 2) return null;
  if (pos.headword.startsWith("(")) return null;
  if (pos.headword.startsWith("-")) return null;
  if (pos.headword.includes("→")) return null;
  // Page number fragments (e.g. "2.", "3.")
  if (/^\d+\.$/.test(pos.headword)) return null;

  return {
    headword: pos.headword,
    pos: pos.pos,
    inflection: pos.inflection,
    examples,
    topic: null,
    regional: pos.regional,
  };
}

// ── Post-processing ────────────────────────────────────────────────

function postProcess(entries: WordEntry[]): WordEntry[] {
  const byHeadword = new Map<string, WordEntry>();

  for (const entry of entries) {
    const key = entry.headword.toLowerCase();
    const existing = byHeadword.get(key);

    if (!existing) {
      byHeadword.set(key, entry);
      continue;
    }

    // Merge: prefer the entry with examples
    if (existing.examples.length === 0 && entry.examples.length > 0) {
      existing.examples = entry.examples;
    }
    // Prefer better POS detection
    if ((existing.pos === "unknown" || existing.pos === "other") &&
        entry.pos !== "unknown" && entry.pos !== "other") {
      existing.pos = entry.pos;
    }
    // Merge inflection data
    if (!existing.inflection && entry.inflection) {
      existing.inflection = entry.inflection;
    }
    if (!existing.regional && entry.regional) {
      existing.regional = entry.regional;
    }
    // Merge additional examples
    for (const ex of entry.examples) {
      if (!existing.examples.includes(ex)) {
        existing.examples.push(ex);
      }
    }
  }

  // Sort alphabetically with German locale
  const result = Array.from(byHeadword.values());
  result.sort((a, b) => a.headword.localeCompare(b.headword, "de"));

  return result;
}

// ── Main PDF Parser ────────────────────────────────────────────────

async function parseGoetheB1(pdfPath: string): Promise<WordEntry[]> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  console.log(`📄 PDF: ${pdfPath}`);
  console.log(`📊 Pages: ${doc.numPages}`);
  console.log(`📍 Parsing pages ${SECTION_START_PAGE}-${doc.numPages}...`);

  const allEntries: WordEntry[] = [];

  for (let pageNum = SECTION_START_PAGE; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const rawItems: TextItem[] = textContent.items
      .filter((item: any) => item.str.trim().length > 0)
      .map((item: any) => ({
        x: item.transform[4],
        y: item.transform[5],
        w: item.width,
        h: item.height,
        text: item.str.trim(),
      }));

    if (rawItems.length === 0) continue;

    // Filter headers, footers, page numbers
    const items = rawItems.filter(
      (item) =>
        item.y > 40 &&
        item.y < 805 &&
        item.text !== "WORTLISTE" &&
        item.text !== "ZERTIFIKAT B1" &&
        item.text !== "VS_0" &&
        item.text !== "3" &&
        item.text !== "2" &&
        !/^[A-ZÄÖÜ]:\s*$/.test(item.text), // standalone "A:", "CH:"
    );

    if (items.length < 3) continue;

    // Split into left/right page columns
    const leftItems = items.filter((i) => i.x < COLUMN_GAP_X);
    const rightItems = items.filter((i) => i.x >= COLUMN_GAP_X);

    for (const colItems of [leftItems, rightItems]) {
      const rawEntries = parseColumn(colItems);
      for (const raw of rawEntries) {
        const entry = rawToEntry(raw);
        if (entry) allEntries.push(entry);
      }
    }

    if (pageNum % 10 === 0) {
      console.log(`  Page ${pageNum}/${doc.numPages} (${allEntries.length} entries)`);
    }
  }

  console.log(`  Page ${doc.numPages}/${doc.numPages} (${allEntries.length} raw entries)`);
  await (doc as any).destroy?.();
  return allEntries;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const pdfPath = "scripts/Goethe-Zertifikat_B1_Wortliste.pdf";
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  console.log("🔍 Parsing Goethe B1 Wortliste PDF...\n");

  const rawEntries = await parseGoetheB1(pdfPath);
  const entries = postProcess(rawEntries);

  // Stats
  const byPos: Record<string, number> = {};
  let withExamples = 0;
  for (const e of entries) {
    byPos[e.pos] = (byPos[e.pos] || 0) + 1;
    if (e.examples.length > 0) withExamples++;
  }

  console.log(`\n📊 Results:`);
  console.log(`   Raw entries: ${rawEntries.length}`);
  console.log(`   After dedup: ${entries.length}`);
  console.log(`   With examples: ${withExamples}`);
  console.log(`   By POS:`);
  for (const [pos, count] of Object.entries(byPos).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${pos}: ${count}`);
  }

  // Quality: headwords that look like real German words
  const qualityEntries = entries.filter(
    (e) => /^[a-zäöüß]/.test(e.headword) && e.examples.length > 0,
  );
  console.log(`   Quality (lowercase + examples): ${qualityEntries.length}`);

  // Spot-check known verbs
  const checkWords = ["abbiegen", "abfahren", "abhängen", "abnehmen", "anbieten", "anfangen", "ankommen", "backen", "bedeuten", "bekommen", "beginnen", "bezahlen", "bleiben", "brauchen", "bringen", "denken", "dürfen", "essen", "fahren", "finden", "fliegen", "geben", "gehen", "gewinnen", "haben", "heißen", "helfen", "kaufen", "kennen", "kommen", "können", "lassen", "laufen", "lesen", "liegen", "machen", "mögen", "müssen", "nehmen", "schreiben", "sehen", "sein", "sprechen", "stehen", "tragen", "treffen", "trinken", "tun", "vergessen", "verlieren", "verstehen", "waschen", "werden", "wissen", "wohnen", "wollen", "ziehen"];
  let foundCount = 0;
  for (const w of checkWords) {
    if (entries.some((e) => e.headword === w)) foundCount++;
  }
  console.log(`   Common verbs found: ${foundCount}/${checkWords.length}`);

  const outDir = path.join("scripts", "transcriptions");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "_wortliste-b1.json");
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf-8");
  console.log(`\n📁 Wrote ${outPath}`);

  // Print samples
  console.log(`\n📋 First 20 entries:`);
  for (const e of entries.slice(0, 20)) {
    const ex = e.examples.length > 0 ? ` ex: ${e.examples[0].slice(0, 80)}` : "";
    console.log(`  ${e.headword} (${e.pos})${ex}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
