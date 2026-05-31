/**
 * Deutsch Üben import pipeline (one-shot, fully automated).
 *
 * Goal: take a single full-length MP3 (one article / one track) + the matching
 * PDF transcript text, and produce:
 *   1. Per-sentence MP3 chunks cut by ffmpeg
 *   2. A clean alignment.json
 *   3. A `documents` + `sentences` rows in Supabase, with audio_url per sentence
 *
 * Run:
 *   npm run dw:import -- <slug>
 *   SKIP_DB=1 npm run dw:import -- <slug>
 *
 * Also exported as `importOne()` for batch drivers (see dw-batch-import.ts).
 */

import { config } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";

config({ path: path.resolve(process.cwd(), ".env.local") });

process.env.WHISPER_NODE_LOG_LEVEL =
  process.env.WHISPER_NODE_LOG_LEVEL ?? "ERROR";

// ------------------------------------------------------------------
// Public types
// ------------------------------------------------------------------
export interface DwMeta {
  title?: string;
  level?: string;
  source?: string;
}

export interface ImportOneOptions {
  slug: string;
  mp3Path?: string;
  text?: string;
  textPath?: string;
  meta?: DwMeta;
  skipDb?: boolean;
  baseDir?: string;
}

export interface ImportOneResult {
  slug: string;
  title: string;
  sentenceCount: number;
  officialMatchCount: number;
  alignmentPath: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function ensureFile(p: string, label: string) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${label}: ${p}`);
  }
}

function parseTime(s: string): number {
  const [hh, mm, rest] = s.split(":");
  const [ss, ms] = rest.replace(",", ".").split(".");
  return (
    Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms ?? 0) / 1000
  );
}

function normalizeWord(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[„“”"()[\]{}]/g, "")
    .replace(/[.,!?;:–—-]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

interface OfficialToken {
  raw: string;
  norm: string;
}

function tokenizeOfficial(text: string): OfficialToken[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((raw) => ({ raw, norm: normalizeWord(raw) }))
    .filter((t) => t.norm.length > 0);
}

function tokenizeSpeech(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(normalizeWord)
    .filter(Boolean);
}

function lcsScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    curr.fill(0);
  }
  const lcs = prev[b.length];
  const precision = lcs / b.length;
  const recall = lcs / a.length;
  return precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);
}

function bestOfficialSpan(
  speechTokens: string[],
  official: OfficialToken[],
  cursor: number,
): { start: number; end: number; score: number } {
  const k = Math.max(1, speechTokens.length);
  let best = { start: cursor, end: cursor, score: 0 };
  const searchStart = Math.max(0, cursor - 4);
  const searchEnd = Math.min(official.length - 1, cursor + 100);
  const minLen = Math.max(1, k - 6);
  const maxLen = Math.min(k + 12, 42);

  for (let start = searchStart; start <= searchEnd; start++) {
    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len;
      if (end > official.length) break;
      const candidate = official.slice(start, end).map((t) => t.norm);
      const score = lcsScore(speechTokens, candidate);
      const distancePenalty = Math.min(Math.abs(start - cursor) * 0.003, 0.08);
      const adjusted = score - distancePenalty;
      if (adjusted > best.score) {
        best = { start, end, score: adjusted };
      }
    }
  }
  return best;
}

function officialText(
  tokens: OfficialToken[],
  start: number,
  end: number,
): string {
  return tokens
    .slice(start, end)
    .map((t) => t.raw)
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1");
}

function runFfmpeg(args: string[], opts: { quiet?: boolean } = {}) {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve to a path");
  execFileSync(ffmpegPath, args, {
    stdio: opts.quiet ? ["ignore", "ignore", "ignore"] : "inherit",
  });
}

interface SilenceRegion {
  start: number;
  end: number;
  mid: number;
}

/**
 * Use ffmpeg's silencedetect filter to find every quiet stretch in the input
 * MP3. Returns regions in seconds, sorted by start. Whisper-node's segment
 * timestamps are unreliable (off by 1-5 seconds for tight dialog), so we use
 * real silence boundaries to snap our sentence cuts.
 */
function detectSilences(
  mp3In: string,
  opts: { noiseDb?: number; minDurationSec?: number } = {},
): SilenceRegion[] {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve to a path");
  const noiseDb = opts.noiseDb ?? -32;
  const minDur = opts.minDurationSec ?? 0.15;
  const child = require("node:child_process").spawnSync(ffmpegPath, [
    "-i",
    mp3In,
    "-af",
    `silencedetect=noise=${noiseDb}dB:duration=${minDur}`,
    "-f",
    "null",
    "-",
  ]);
  const stderr = (child.stderr ?? Buffer.from("")).toString("utf-8");
  const regions: SilenceRegion[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (startMatch) {
      pendingStart = Math.max(0, Number(startMatch[1]));
      continue;
    }
    const endMatch = line.match(
      /silence_end:\s*(-?[\d.]+).*silence_duration:\s*(-?[\d.]+)/,
    );
    if (endMatch && pendingStart !== null) {
      const end = Number(endMatch[1]);
      const start = pendingStart;
      regions.push({
        start,
        end,
        mid: +((start + end) / 2).toFixed(3),
      });
      pendingStart = null;
    }
  }
  return regions;
}

/**
 * Rewrite each sentence boundary so it falls on a real silence midpoint.
 * For boundary B between sentence i and i+1:
 *   - search silences in [B - window, B + window]
 *   - prefer the silence with the largest duration within that window
 *   - if found, set sentences[i].endSec = sentences[i+1].startSec = silence.mid
 *   - if no silence in window, leave both boundaries unchanged (Whisper's
 *     timestamps will have to do)
 *
 * The first sentence's startSec and the last sentence's endSec are also
 * snapped to the nearest silence (or kept at 0 / file end).
 */
function snapBoundariesToSilences(
  sentences: AlignedSentence[],
  silences: SilenceRegion[],
  totalDurationSec: number,
  window = 2.5,
): AlignedSentence[] {
  if (sentences.length === 0 || silences.length === 0) return sentences;

  function bestSilenceNear(t: number): SilenceRegion | null {
    let best: SilenceRegion | null = null;
    let bestScore = -Infinity;
    for (const r of silences) {
      if (r.mid < t - window || r.mid > t + window) continue;
      const distance = Math.abs(r.mid - t);
      const dur = r.end - r.start;
      // Score = duration - 0.5 * distance. Long silences dominate; ties go
      // to whichever is closer to Whisper's estimate.
      const score = dur - 0.5 * distance;
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    return best;
  }

  // Internal boundaries.
  for (let i = 0; i < sentences.length - 1; i++) {
    const boundary = sentences[i].endSec;
    const snap = bestSilenceNear(boundary);
    if (!snap) continue;
    const newBoundary = snap.mid;
    // Never let an internal boundary invert either side. This can happen at
    // the very end of some tracks when Whisper's final segment end is earlier
    // than the closest silence midpoint chosen for the previous boundary.
    if (
      newBoundary <= sentences[i].startSec ||
      newBoundary >= sentences[i + 1].endSec
    ) {
      continue;
    }
    sentences[i].endSec = +newBoundary.toFixed(3);
    sentences[i + 1].startSec = +newBoundary.toFixed(3);
    sentences[i].duration = +(
      sentences[i].endSec - sentences[i].startSec
    ).toFixed(2);
  }
  // Leading edge: snap startSec[0] backwards toward the first silence
  // immediately before it (so we don't cut off the opening syllable).
  const firstSnap = silences.find(
    (r) =>
      r.end <= sentences[0].startSec &&
      sentences[0].startSec - r.end < window,
  );
  if (firstSnap) {
    sentences[0].startSec = +firstSnap.mid.toFixed(3);
    sentences[0].duration = +(
      sentences[0].endSec - sentences[0].startSec
    ).toFixed(2);
  }
  // Trailing edge.
  const last = sentences[sentences.length - 1];
  const trailingSnap = bestSilenceNear(last.endSec);
  if (trailingSnap && trailingSnap.mid > last.startSec) {
    last.endSec = +Math.min(totalDurationSec, trailingSnap.mid).toFixed(3);
    last.duration = +(last.endSec - last.startSec).toFixed(2);
  }
  return sentences;
}

interface RawSegment {
  start: number;
  end: number;
  speech: string;
}

interface AlignedSentence {
  audioFile: string;
  startSec: number;
  endSec: number;
  duration: number;
  text: string;
  whisper: string;
  match: { kind: "official" | "whisper-only"; score: number };
}

async function transcribeFull(
  wavCache: string,
  segCache: string,
): Promise<RawSegment[]> {
  if (fs.existsSync(segCache)) {
    console.log(`🧠 Whisper cache hit → ${path.relative(process.cwd(), segCache)}`);
    return JSON.parse(fs.readFileSync(segCache, "utf-8")) as RawSegment[];
  }
  console.log(`🧠 Whisper transcribing (base model, de)...`);
  const { whisper } = await import("@lumen-labs-dev/whisper-node");
  const lines = await whisper(wavCache, {
    modelName: "base",
    whisperOptions: {
      language: "de",
      word_timestamps: false,
    },
    shellOptions: {
      silent: true,
      async: false,
    },
  });
  const segs: RawSegment[] = lines
    .filter((l) => l.speech.trim().length > 0)
    .map((l) => ({
      start: parseTime(l.start),
      end: parseTime(l.end),
      speech: l.speech.trim(),
    }));
  fs.mkdirSync(path.dirname(segCache), { recursive: true });
  fs.writeFileSync(segCache, JSON.stringify(segs, null, 2), "utf-8");
  console.log(`   → ${segs.length} segments cached`);
  return segs;
}

/**
 * Whisper splits on every pause. That's great for natural rhythm but bad
 * for sentence boundaries — a single grammatical sentence with a comma-pause
 * gets cut into two display "sentences", the second one orphaned without a
 * subject (e.g. ", und fragst mich dann..."). Merge such fragments back into
 * the previous segment, using the OFFICIAL text's terminal punctuation as
 * the canonical sentence boundary.
 */
function mergeBrokenSentences(
  aligned: AlignedSentence[],
): AlignedSentence[] {
  const merged: AlignedSentence[] = [];
  for (const cur of aligned) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...cur });
      continue;
    }
    // Look at the LAST non-quote character of the previous fragment's text.
    // If it's a terminator (.!?…) we have a complete sentence; otherwise the
    // segment continues into `cur`.
    const tail = prev.text.replace(/[\s„“”"»«)\]]+$/, "").slice(-1);
    const prevComplete = /[.!?…]/.test(tail);
    if (prevComplete) {
      merged.push({ ...cur });
      continue;
    }
    // Merge `cur` into `prev`.
    prev.endSec = cur.endSec;
    prev.duration = +(cur.endSec - prev.startSec).toFixed(2);
    prev.text = `${prev.text} ${cur.text}`.replace(/\s+/g, " ").trim();
    prev.whisper = `${prev.whisper} ${cur.whisper}`.replace(/\s+/g, " ").trim();
    // Demote the merged kind: any whisper-only fragment turns the whole
    // sentence into a partial match. Take the weaker score.
    prev.match = {
      kind:
        prev.match.kind === "whisper-only" || cur.match.kind === "whisper-only"
          ? prev.match.kind === "official" && cur.match.kind === "whisper-only"
            ? "official" // keep "official" if only the trailing tail is whisper-only
            : "whisper-only"
          : "official",
      score: +Math.min(prev.match.score, cur.match.score).toFixed(3),
    };
  }
  // Renumber audio files so they're 001..NNN with no gaps.
  return merged.map((s, i) => ({
    ...s,
    audioFile: `${String(i + 1).padStart(3, "0")}.mp3`,
  }));
}

function alignSegments(
  segments: RawSegment[],
  officialTokens: OfficialToken[],
): AlignedSentence[] {
  let cursor = 0;
  return segments.map((seg, i) => {
    const speechTokens = tokenizeSpeech(seg.speech);
    const span = bestOfficialSpan(speechTokens, officialTokens, cursor);
    const isOfficial = span.score >= 0.48 && span.end > span.start;
    const text = isOfficial
      ? officialText(officialTokens, span.start, span.end)
      : seg.speech;
    if (isOfficial) cursor = span.end;
    const audioFile = `${String(i + 1).padStart(3, "0")}.mp3`;
    return {
      audioFile,
      startSec: +seg.start.toFixed(3),
      endSec: +seg.end.toFixed(3),
      duration: +(seg.end - seg.start).toFixed(2),
      text,
      whisper: seg.speech,
      match: {
        kind: isOfficial ? "official" : "whisper-only",
        score: +span.score.toFixed(3),
      },
    };
  });
}

function cutAudio(
  sentences: AlignedSentence[],
  mp3In: string,
  audioOutDir: string,
) {
  fs.mkdirSync(audioOutDir, { recursive: true });
  for (const f of fs.readdirSync(audioOutDir)) {
    if (f.toLowerCase().endsWith(".mp3")) {
      fs.unlinkSync(path.join(audioOutDir, f));
    }
  }
  // Boundaries have been snapped to real silence centres by
  // snapBoundariesToSilences(), so each startSec / endSec sits in the
  // middle of an actual quiet stretch. Cutting on those points gives every
  // clip ~75-150 ms of pre-roll silence and ~75-150 ms of tail silence —
  // exactly the "shadow before / shadow after, full sentence in the middle"
  // shape we want. No extra padding required; any added padding would just
  // re-introduce the next sentence's onset.
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const start = Math.max(0, s.startSec);
    const end = s.endSec;
    const duration = end - start;
    const outPath = path.join(audioOutDir, s.audioFile);
    runFfmpeg(
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        mp3In,
        "-ss",
        start.toFixed(3),
        "-t",
        duration.toFixed(3),
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
        "-ac",
        "1",
        outPath,
      ],
      { quiet: true },
    );
    if ((i + 1) % 10 === 0 || i === sentences.length - 1) {
      console.log(`   cut ${i + 1}/${sentences.length}`);
    }
  }
}

async function importToSupabase(
  sentences: AlignedSentence[],
  ctx: { title: string; level: string; source: string | null; slug: string },
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn(
      "⚠️  Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skipping DB.",
    );
    return;
  }
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`🧹 Removing any prior "${ctx.title}" rows…`);
  const { data: existing } = await sb
    .from("documents")
    .select("id")
    .eq("title", ctx.title);
  if (existing && existing.length > 0) {
    for (const row of existing) {
      await sb.from("sentences").delete().eq("document_id", row.id);
      await sb.from("documents").delete().eq("id", row.id);
    }
    console.log(`   removed ${existing.length} prior document(s)`);
  } else {
    console.log("   none to remove");
  }

  console.log(`📥 Inserting document…`);
  const { data: docRow, error: docErr } = await sb
    .from("documents")
    .insert({
      title: ctx.title,
      source: ctx.source,
      level: ctx.level,
      total_sentences: sentences.length,
      progress: 0,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const documentId = docRow.id as string;
  console.log(`   id = ${documentId}`);

  console.log(`📥 Inserting ${sentences.length} sentences…`);
  const rows = sentences.map((s, i) => ({
    document_id: documentId,
    index: i,
    original: s.text,
    translation: null,
    grammar: null,
    audio_url: `/audio/${ctx.slug}/${s.audioFile}`,
    mastery: 0,
  }));
  const { error: sErr } = await sb.from("sentences").insert(rows);
  if (sErr) throw sErr;
}

// ------------------------------------------------------------------
// Main export
// ------------------------------------------------------------------
export async function importOne(
  opts: ImportOneOptions,
): Promise<ImportOneResult> {
  const baseDir = opts.baseDir ?? process.cwd();
  const slug = opts.slug;
  const mp3In =
    opts.mp3Path ?? path.join(baseDir, "public", "audio", `${slug}.mp3`);
  const txtIn =
    opts.textPath ??
    path.join(baseDir, "scripts", "transcripts", `${slug}.txt`);
  const metaIn = path.join(
    baseDir,
    "scripts",
    "transcripts",
    `${slug}.meta.json`,
  );
  const wavCache = path.join(
    baseDir,
    "scripts",
    "transcriptions",
    `${slug}.input.wav`,
  );
  const segCache = path.join(
    baseDir,
    "scripts",
    "transcriptions",
    `${slug}-full.json`,
  );
  const alignOut = path.join(
    baseDir,
    "scripts",
    "alignments",
    `${slug}.json`,
  );
  const audioOutDir = path.join(baseDir, "public", "audio", slug);
  const skipDb = opts.skipDb ?? false;

  const meta: DwMeta =
    opts.meta ??
    (fs.existsSync(metaIn)
      ? (JSON.parse(
          fs.readFileSync(metaIn, "utf-8").replace(/^\uFEFF/, ""),
        ) as DwMeta)
      : {});
  const title = meta.title ?? slug;
  const level = meta.level ?? "B1";
  const source = meta.source ?? null;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📂 Slug:   ${slug}`);
  console.log(`📘 Title:  ${title}`);
  console.log(`📊 Level:  ${level}`);
  console.log(`📚 Source: ${source ?? "—"}`);

  ensureFile(mp3In, "MP3");
  const transcript =
    opts.text ??
    (fs.existsSync(txtIn)
      ? fs.readFileSync(txtIn, "utf-8")
      : (() => {
          throw new Error(`Missing transcript: ${txtIn}`);
        })());

  if (!fs.existsSync(wavCache)) {
    console.log(`\n🎵 Converting MP3 → 16 kHz mono wav…`);
    fs.mkdirSync(path.dirname(wavCache), { recursive: true });
    runFfmpeg(
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        mp3In,
        "-ar",
        "16000",
        "-ac",
        "1",
        wavCache,
      ],
      { quiet: true },
    );
  } else {
    console.log(`\n🎵 Wav cache hit → ${path.relative(baseDir, wavCache)}`);
  }

  const segments = await transcribeFull(wavCache, segCache);
  if (segments.length === 0) {
    throw new Error("Whisper returned 0 segments");
  }
  const totalAudio = segments[segments.length - 1].end;
  console.log(
    `   ${segments.length} segments, last ends at ${totalAudio.toFixed(1)}s`,
  );

  console.log(`\n🔗 Aligning to transcript…`);
  const officialTokens = tokenizeOfficial(transcript);
  const rawAligned = alignSegments(segments, officialTokens);
  const merged = mergeBrokenSentences(rawAligned);
  const officialCount = merged.filter(
    (s) => s.match.kind === "official",
  ).length;
  console.log(
    `   ${rawAligned.length} pause-segments → ${merged.length} sentences` +
      ` (merged ${rawAligned.length - merged.length} comma-pauses).` +
      ` ${officialCount}/${merged.length} match official text.`,
  );

  // Whisper's timestamps drift by 1-5 s for tight dialog. Use ffmpeg to find
  // the real silences in the source MP3 and snap every sentence boundary to
  // the centre of the nearest matching silence. This is what guarantees each
  // clip contains its FULL sentence and nothing of the next.
  console.log(`\n🔇 Detecting silences for boundary correction…`);
  const silences = detectSilences(mp3In);
  console.log(`   found ${silences.length} silence regions`);
  const aligned = snapBoundariesToSilences(merged, silences, totalAudio);

  console.log(`\n✂️  Cutting MP3 into ${aligned.length} chunks…`);
  cutAudio(aligned, mp3In, audioOutDir);

  fs.mkdirSync(path.dirname(alignOut), { recursive: true });
  fs.writeFileSync(
    alignOut,
    JSON.stringify(
      {
        slug,
        title,
        level,
        source,
        audioPathPrefix: `/audio/${slug}/`,
        totalDuration: +totalAudio.toFixed(2),
        sentences: aligned,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`📝 Alignment → ${path.relative(baseDir, alignOut)}`);

  if (skipDb) {
    console.log(`\n⏭️  SKIP_DB set, skipping Supabase import.`);
  } else {
    console.log(`\n📥 Importing to Supabase…`);
    await importToSupabase(aligned, { title, level, source, slug });
  }

  console.log(`\n✅ Done: "${title}" (${aligned.length} sentences).`);
  return {
    slug,
    title,
    sentenceCount: aligned.length,
    officialMatchCount: officialCount,
    alignmentPath: alignOut,
  };
}

// ------------------------------------------------------------------
// CLI entry
// ------------------------------------------------------------------
async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run dw:import -- <slug>");
    console.error("Example: npm run dw:import -- du-b1-05-a2a");
    process.exit(1);
  }
  const skipDb =
    process.env.SKIP_DB === "1" || process.argv.includes("--skip-db");
  await importOne({ slug, skipDb });
}

const isDirectRun =
  process.argv[1]?.includes("dw-import") &&
  !process.argv[1]?.includes("dw-batch-import");

if (isDirectRun) {
  main().catch((err) => {
    console.error("\n❌ dw-import failed:", err);
    process.exit(1);
  });
}
