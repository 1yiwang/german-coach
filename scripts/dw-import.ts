/**
 * Deutsch Üben import pipeline (one-shot, fully automated).
 *
 * Goal: take a single full-length MP3 (one article / one track) + the matching
 * PDF transcript text, and produce:
 *   1. Per-sentence MP3 chunks cut by ffmpeg
 *   2. A clean alignment.json
 *   3. A `documents` + `sentences` rows in Supabase, with audio_url per sentence
 *
 * Inputs (you provide these by hand):
 *   public/audio/<slug>.mp3                — the full audio file
 *   scripts/transcripts/<slug>.txt          — the PDF transcript
 *   scripts/transcripts/<slug>.meta.json    — optional { title, level, source }
 *
 * Run:
 *   npm run dw:import -- <slug>
 *
 * Outputs (gitignored):
 *   scripts/transcriptions/<slug>.input.wav      — 16 kHz mono wav for whisper
 *   scripts/transcriptions/<slug>-full.json      — whisper segments cache
 *   scripts/alignments/<slug>.json               — final alignment record
 *   public/audio/<slug>/NNN.mp3                  — per-segment cut mp3s
 *
 * Why split into a new script:
 *   The older transcribe-chunks / align-from-whisper / import-aligned pair
 *   assumes you pre-cut WAVs in Audacity. This script is what you reach for
 *   when you have one big MP3 and want zero manual chopping.
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
// CLI args
// ------------------------------------------------------------------
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npm run dw:import -- <slug>");
  console.error("Example: npm run dw:import -- du-hs-b1-48");
  process.exit(1);
}
// npm strips --foo flags from `npm run`. Use SKIP_DB=1 npm run dw:import -- <slug>
// to avoid writing to Supabase (useful for testing alignment before commit).
const skipDb =
  process.env.SKIP_DB === "1" || process.argv.includes("--skip-db");

// ------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------
const baseDir = process.cwd();
const mp3In = path.join(baseDir, "public", "audio", `${slug}.mp3`);
const txtIn = path.join(baseDir, "scripts", "transcripts", `${slug}.txt`);
const metaIn = path.join(baseDir, "scripts", "transcripts", `${slug}.meta.json`);
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

// ------------------------------------------------------------------
// Meta sidecar (optional)
// ------------------------------------------------------------------
interface DwMeta {
  title?: string;
  level?: string;
  source?: string;
}
const meta: DwMeta = fs.existsSync(metaIn)
  ? (JSON.parse(
      fs.readFileSync(metaIn, "utf-8").replace(/^\uFEFF/, ""),
    ) as DwMeta)
  : {};
const title = meta.title ?? slug;
const level = meta.level ?? "B1";
const source = meta.source ?? null;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function ensureFile(p: string, label: string) {
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing ${label}: ${p}`);
    process.exit(1);
  }
}

function parseTime(s: string): number {
  // whisper-node emits "HH:MM:SS.mmm" (and sometimes with ',' as decimal).
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
      // Prefer spans closer to the cursor so repeated words ("Loreley") don't
      // make the alignment jump forward.
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

// ------------------------------------------------------------------
// Pipeline
// ------------------------------------------------------------------
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

async function transcribeFull(): Promise<RawSegment[]> {
  if (fs.existsSync(segCache)) {
    console.log(`🧠 Whisper cache hit → ${path.relative(baseDir, segCache)}`);
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

function alignSegments(
  segments: RawSegment[],
  officialTokens: OfficialToken[],
): AlignedSentence[] {
  let cursor = 0;
  return segments.map((seg, i) => {
    const speechTokens = tokenizeSpeech(seg.speech);
    const span = bestOfficialSpan(speechTokens, officialTokens, cursor);
    // 0.48 was the working threshold for Loreley intro vs body. Same here:
    // below 0.48 we treat the chunk as something that isn't in the PDF
    // (intro, instructions, page header read aloud, etc.) and keep Whisper.
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

function cutAudio(sentences: AlignedSentence[]) {
  fs.mkdirSync(audioOutDir, { recursive: true });
  // Wipe stale chunks so a rerun doesn't leave orphans.
  for (const f of fs.readdirSync(audioOutDir)) {
    if (f.toLowerCase().endsWith(".mp3")) {
      fs.unlinkSync(path.join(audioOutDir, f));
    }
  }
  const padding = 0.12; // 120 ms padding to avoid clipping the first syllable.
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const start = Math.max(0, s.startSec - padding);
    const duration = s.endSec + padding - start;
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

async function importToSupabase(sentences: AlignedSentence[]) {
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

  console.log(`🧹 Removing any prior "${title}" rows…`);
  const { data: existing } = await sb
    .from("documents")
    .select("id")
    .eq("title", title);
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
      title,
      source,
      level,
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
    audio_url: `/audio/${slug}/${s.audioFile}`,
    mastery: 0,
  }));
  const { error: sErr } = await sb.from("sentences").insert(rows);
  if (sErr) throw sErr;
}

async function main() {
  console.log(`📂 Slug:   ${slug}`);
  console.log(`📘 Title:  ${title}`);
  console.log(`📊 Level:  ${level}`);
  console.log(`📚 Source: ${source ?? "—"}`);

  ensureFile(mp3In, "MP3");
  ensureFile(txtIn, "transcript");

  // 1) MP3 → 16 kHz mono wav for whisper.cpp.
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

  // 2) Whisper transcription (cached).
  const segments = await transcribeFull();
  if (segments.length === 0) {
    console.error("❌ Whisper returned 0 segments. Aborting.");
    process.exit(1);
  }
  const totalAudio = segments[segments.length - 1].end;
  console.log(
    `   ${segments.length} segments, last ends at ${totalAudio.toFixed(1)}s`,
  );

  // 3) Fuzzy-align each Whisper segment to the official transcript.
  console.log(`\n🔗 Aligning to transcript…`);
  const officialTokens = tokenizeOfficial(fs.readFileSync(txtIn, "utf-8"));
  const aligned = alignSegments(segments, officialTokens);
  const officialCount = aligned.filter(
    (s) => s.match.kind === "official",
  ).length;
  console.log(
    `   ${officialCount}/${aligned.length} matched official text` +
      ` (rest kept Whisper, e.g. intro/instructions)`,
  );

  // 4) Cut audio.
  console.log(`\n✂️  Cutting MP3 into ${aligned.length} chunks…`);
  cutAudio(aligned);

  // 5) Write alignment.json.
  fs.mkdirSync(path.dirname(alignOut), { recursive: true });
  const alignmentFile = {
    slug,
    title,
    level,
    source,
    audioPathPrefix: `/audio/${slug}/`,
    totalDuration: +totalAudio.toFixed(2),
    sentences: aligned,
  };
  fs.writeFileSync(
    alignOut,
    JSON.stringify(alignmentFile, null, 2),
    "utf-8",
  );
  console.log(`📝 Alignment → ${path.relative(baseDir, alignOut)}`);

  // 6) Supabase import.
  if (skipDb) {
    console.log(`\n⏭️  SKIP_DB set, skipping Supabase import.`);
  } else {
    console.log(`\n📥 Importing to Supabase…`);
    await importToSupabase(aligned);
  }

  console.log(`\n✅ Done.`);
  console.log(`   /listen → "${title}" → ▶ plays real audio.`);
  console.log(`\nFirst 5 aligned sentences:`);
  aligned.slice(0, 5).forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(2)} [${s.match.kind} ${s.match.score}] ${s.audioFile} (${s.duration}s)`,
    );
    console.log(`   W: ${s.whisper}`);
    console.log(`   T: ${s.text}`);
  });
}

main().catch((err) => {
  console.error("\n❌ dw-import failed:", err);
  process.exit(1);
});
