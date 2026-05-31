/**
 * Align a folder of pre-chopped .wav files (one per audio chunk) to a German
 * transcript .txt, producing an alignment.json that a downstream import script
 * can write to Supabase.
 *
 * Usage:
 *   tsx scripts/align-audio.ts <slug> [--intro-skip=N]
 *
 * Example:
 *   tsx scripts/align-audio.ts b1-track-48 --intro-skip=3
 *
 * Inputs:
 *   public/audio/<slug>/*.wav          — chopped audio (alphabetical = order)
 *   scripts/transcripts/<slug>.txt     — full German transcript
 *
 * Output:
 *   scripts/alignments/<slug>.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CliArgs {
  slug: string;
  introSkip: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--")) ?? "b1-track-48";
  const introArg = args.find((a) => a.startsWith("--intro-skip="));
  const introSkip = introArg ? parseInt(introArg.split("=")[1], 10) : 3;
  return { slug, introSkip };
}

/**
 * Parse a RIFF/WAVE file header to extract its play duration in seconds.
 * Walks the chunk list because some WAVs have extra chunks (e.g. LIST INFO)
 * between `fmt ` and `data`, so a fixed-offset reader is fragile.
 */
function readWavDuration(filePath: string): number {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`Not RIFF: ${filePath}`);
  }
  if (buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not WAVE: ${filePath}`);
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      byteRate = buf.readUInt32LE(offset + 8 + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset += 1; // RIFF chunks are word-aligned.
  }
  if (!byteRate || !dataSize) {
    throw new Error(`No fmt/data chunk: ${filePath}`);
  }
  return dataSize / byteRate;
}

/**
 * Hard split — periods, exclamation, question, semicolon, colon only.
 * Commas left alone for the iterative-bisect step below.
 */
function splitHard(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const clauses: string[] = [];
  let buf = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    buf += c;
    if (/[.!?;:]/.test(c)) {
      // Eat trailing punctuation like "?!" or ".)".
      while (
        i + 1 < normalized.length &&
        /[.!?;:]/.test(normalized[i + 1])
      ) {
        i++;
        buf += normalized[i];
      }
      const clause = buf.trim();
      if (clause.length > 0) clauses.push(clause);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) clauses.push(tail);
  return clauses;
}

/**
 * Bisect the longest comma-bearing clause at the comma closest to its midpoint.
 * Returns true if a split happened, false if no clause has a comma to split on.
 */
function bisectLongestAtMidComma(clauses: string[]): boolean {
  let longestIdx = -1;
  let longestLen = 0;
  for (let i = 0; i < clauses.length; i++) {
    if (clauses[i].includes(",") && clauses[i].length > longestLen) {
      longestLen = clauses[i].length;
      longestIdx = i;
    }
  }
  if (longestIdx === -1) return false;

  const c = clauses[longestIdx];
  const mid = c.length / 2;
  let bestCommaIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === ",") {
      const d = Math.abs(i - mid);
      if (d < bestDist) {
        bestDist = d;
        bestCommaIdx = i;
      }
    }
  }
  if (bestCommaIdx === -1) return false;

  const left = c.slice(0, bestCommaIdx + 1).trim();
  const right = c.slice(bestCommaIdx + 1).trim();
  if (!left || !right) return false;
  clauses.splice(longestIdx, 1, left, right);
  return true;
}

/**
 * Split a transcript into exactly `target` clauses by hard-splitting first,
 * then iteratively bisecting the longest remaining clause at its central comma
 * until count == target. If the target is below the hard-split count we
 * iteratively merge the two shortest neighbours instead.
 */
function splitToTarget(text: string, target: number): string[] {
  const clauses = splitHard(text);
  while (clauses.length < target) {
    if (!bisectLongestAtMidComma(clauses)) break;
  }
  while (clauses.length > target) {
    // Merge the two shortest neighbours.
    let minIdx = 0;
    let minSum = Infinity;
    for (let i = 0; i < clauses.length - 1; i++) {
      const s = clauses[i].length + clauses[i + 1].length;
      if (s < minSum) {
        minSum = s;
        minIdx = i;
      }
    }
    clauses.splice(
      minIdx,
      2,
      (clauses[minIdx] + " " + clauses[minIdx + 1]).trim(),
    );
  }
  return clauses;
}

/**
 * Pair N audio chunks with M text clauses, preserving order. If N == M, it's a
 * straight zip. Otherwise we use cumulative duration vs cumulative char count
 * as a weight, so the wav-text balance stays roughly even across the whole
 * track even if individual pairings drift by one clause.
 */
function alignWeighted(
  wavs: { name: string; duration: number }[],
  clauses: string[],
): { audioFile: string; duration: number; text: string }[] {
  if (wavs.length === 0) return [];
  if (clauses.length === 0) {
    return wavs.map((w) => ({
      audioFile: w.name,
      duration: +w.duration.toFixed(2),
      text: "",
    }));
  }
  const totalDur = wavs.reduce((s, w) => s + w.duration, 0);
  const totalChars = clauses.reduce((s, c) => s + c.length, 0);
  const charsPerSec = totalChars / totalDur;

  const out: { audioFile: string; duration: number; text: string }[] = [];
  let clauseIdx = 0;
  let consumedChars = 0;
  let consumedDur = 0;
  for (let w = 0; w < wavs.length; w++) {
    const wav = wavs[w];
    consumedDur += wav.duration;
    const targetChars = consumedDur * charsPerSec;
    const pieces: string[] = [];
    while (
      clauseIdx < clauses.length &&
      (pieces.length === 0 || consumedChars < targetChars * 0.85) &&
      // leave at least 1 clause for each remaining wav (don't drain too fast)
      clauses.length - clauseIdx > wavs.length - 1 - w
    ) {
      pieces.push(clauses[clauseIdx]);
      consumedChars += clauses[clauseIdx].length;
      clauseIdx++;
    }
    // Guarantee at least one clause per wav.
    if (pieces.length === 0 && clauseIdx < clauses.length) {
      pieces.push(clauses[clauseIdx]);
      consumedChars += clauses[clauseIdx].length;
      clauseIdx++;
    }
    out.push({
      audioFile: wav.name,
      duration: +wav.duration.toFixed(2),
      text: pieces.join(" "),
    });
  }
  // Anything left over: append to last wav so no clause is lost.
  if (clauseIdx < clauses.length) {
    const tail = clauses.slice(clauseIdx).join(" ");
    out[out.length - 1].text =
      (out[out.length - 1].text + " " + tail).trim();
  }
  return out;
}

function main(): void {
  const { slug, introSkip } = parseArgs();
  const audioDir = path.join(process.cwd(), "public", "audio", slug);
  const transcriptPath = path.join(
    process.cwd(),
    "scripts",
    "transcripts",
    `${slug}.txt`,
  );
  const outputPath = path.join(
    process.cwd(),
    "scripts",
    "alignments",
    `${slug}.json`,
  );

  if (!fs.existsSync(audioDir)) {
    console.error(`❌ Audio dir not found: ${audioDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(transcriptPath)) {
    console.error(`❌ Transcript not found: ${transcriptPath}`);
    process.exit(1);
  }

  const wavFiles = fs
    .readdirSync(audioDir)
    .filter((f) => f.toLowerCase().endsWith(".wav"))
    .sort();
  const wavs = wavFiles.map((name) => ({
    name,
    duration: readWavDuration(path.join(audioDir, name)),
  }));

  const transcript = fs.readFileSync(transcriptPath, "utf-8");

  const intro = wavs.slice(0, introSkip);
  const content = wavs.slice(introSkip);

  const totalDur = wavs.reduce((s, w) => s + w.duration, 0);
  const introDur = intro.reduce((s, w) => s + w.duration, 0);

  // Split transcript to match audio chunk count exactly (1:1 alignment).
  const clauses = splitToTarget(transcript, content.length);

  console.log(`\n📂 Slug:           ${slug}`);
  console.log(`🎧 Audio chunks:   ${wavs.length} total`);
  console.log(
    `   → intro (skip): ${intro.length} (${introDur.toFixed(1)}s)`,
  );
  console.log(
    `   → content:      ${content.length} (${(totalDur - introDur).toFixed(1)}s)`,
  );
  console.log(
    `📝 Text clauses:   ${clauses.length} (target = ${content.length})`,
  );

  const matched =
    content.length === clauses.length
      ? content.map((wav, i) => ({
          audioFile: wav.name,
          duration: +wav.duration.toFixed(2),
          text: clauses[i],
        }))
      : alignWeighted(content, clauses);
  const mode =
    content.length === clauses.length
      ? "perfect-1to1"
      : `weighted-fallback (${content.length} audio vs ${clauses.length} text)`;
  console.log(`🔗 Alignment mode: ${mode}`);

  const out = {
    slug,
    title: "Die Loreley-Sage",
    level: "B1",
    source: "Hueber · Deutsch üben Hören und Sprechen B1 · Track 48",
    introSkip,
    introFiles: intro.map((w) => ({
      name: w.name,
      duration: +w.duration.toFixed(2),
    })),
    totalDuration: +totalDur.toFixed(2),
    audioPathPrefix: `/audio/${slug}/`,
    sentences: matched,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), "utf-8");

  console.log(`\n💾 Wrote: ${outputPath}`);
  console.log(`\n👀 First 6 pairings:`);
  matched.slice(0, 6).forEach((a, i) => {
    const txt = a.text.length > 75 ? a.text.slice(0, 75) + "…" : a.text;
    console.log(
      `  ${String(i + 1).padStart(2)}. [${a.duration.toString().padStart(5)}s] ${a.audioFile}`,
    );
    console.log(`      "${txt}"`);
  });
  console.log(`\n👀 Last 3 pairings:`);
  matched.slice(-3).forEach((a, idx) => {
    const i = matched.length - 3 + idx;
    const txt = a.text.length > 75 ? a.text.slice(0, 75) + "…" : a.text;
    console.log(
      `  ${String(i + 1).padStart(2)}. [${a.duration.toString().padStart(5)}s] ${a.audioFile}`,
    );
    console.log(`      "${txt}"`);
  });
}

main();
