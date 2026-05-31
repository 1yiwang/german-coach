/**
 * Align Whisper chunk transcriptions to the official transcript.
 *
 * Why this exists:
 * Audacity's Silence Finder splits on real pauses, not punctuation. A PDF
 * transcript split by commas/periods will drift. Whisper gives us the actual
 * speech per audio chunk; this script uses that speech to find the matching
 * span inside the official transcript, while preserving the official text when
 * a confident match exists.
 *
 * Output:
 *   scripts/alignments/<slug>.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface TranscribedChunk {
  audioFile: string;
  duration: number;
  speech: string;
}

interface OfficialToken {
  raw: string;
  norm: string;
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
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function bestOfficialSpan(
  speechTokens: string[],
  official: OfficialToken[],
  cursor: number,
): { start: number; end: number; score: number } {
  const k = Math.max(1, speechTokens.length);
  let best = { start: cursor, end: cursor, score: 0 };
  const searchStart = Math.max(0, cursor - 4);
  const searchEnd = Math.min(official.length - 1, cursor + 80);
  const minLen = Math.max(1, k - 6);
  const maxLen = Math.min(k + 10, 36);

  for (let start = searchStart; start <= searchEnd; start++) {
    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len;
      if (end > official.length) break;
      const candidate = official.slice(start, end).map((t) => t.norm);
      const score = lcsScore(speechTokens, candidate);
      // Slightly prefer spans that start closer to cursor to avoid jumping
      // forward on repeated words like "Loreley".
      const distancePenalty = Math.min(Math.abs(start - cursor) * 0.003, 0.08);
      const adjusted = score - distancePenalty;
      if (adjusted > best.score) {
        best = { start, end, score: adjusted };
      }
    }
  }
  return best;
}

function officialText(tokens: OfficialToken[], start: number, end: number): string {
  return tokens
    .slice(start, end)
    .map((t) => t.raw)
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1");
}

function main() {
  const slug = process.argv[2] ?? "b1-track-48";
  const title = "Die Loreley-Sage";
  const level = "B1";
  const source = "Hueber · Deutsch üben Hören und Sprechen B1 · Track 48";

  const transcriptionPath = path.join(
    process.cwd(),
    "scripts",
    "transcriptions",
    `${slug}.json`,
  );
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

  const chunks = JSON.parse(
    fs.readFileSync(transcriptionPath, "utf-8"),
  ) as TranscribedChunk[];
  const official = tokenizeOfficial(fs.readFileSync(transcriptPath, "utf-8"));

  let cursor = 0;
  const sentences = chunks.map((chunk) => {
    const speechTokens = tokenizeSpeech(chunk.speech);
    const span = bestOfficialSpan(speechTokens, official, cursor);
    // Below ~0.48, treat this chunk as extra intro/prompt material that is not
    // in the PDF transcript. Keep Whisper text so the audio still has a label.
    const isOfficial = span.score >= 0.48 && span.end > span.start;
    const text = isOfficial
      ? officialText(official, span.start, span.end)
      : chunk.speech.trim();
    if (isOfficial) cursor = span.end;
    return {
      audioFile: chunk.audioFile,
      duration: chunk.duration,
      text,
      whisper: chunk.speech,
      match: isOfficial
        ? {
            kind: "official",
            score: +span.score.toFixed(3),
            startToken: span.start,
            endToken: span.end,
          }
        : {
            kind: "whisper-only",
            score: +span.score.toFixed(3),
          },
    };
  });

  const output = {
    slug,
    title,
    level,
    source,
    totalDuration: +chunks.reduce((sum, c) => sum + c.duration, 0).toFixed(2),
    audioPathPrefix: `/audio/${slug}/`,
    sentences,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`Wrote ${outputPath}`);
  console.log(`Official cursor ended at token ${cursor}/${official.length}`);
  console.log("\nFirst 10:");
  sentences.slice(0, 10).forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(2)} ${s.audioFile} [${s.match.kind} ${s.match.score}]`,
    );
    console.log(`   W: ${s.whisper}`);
    console.log(`   T: ${s.text}`);
  });
  console.log("\nLast 5:");
  sentences.slice(-5).forEach((s, idx) => {
    const i = sentences.length - 5 + idx + 1;
    console.log(
      `${String(i).padStart(2)} ${s.audioFile} [${s.match.kind} ${s.match.score}]`,
    );
    console.log(`   W: ${s.whisper}`);
    console.log(`   T: ${s.text}`);
  });
}

main();
