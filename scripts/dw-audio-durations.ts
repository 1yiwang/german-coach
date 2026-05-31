/**
 * One-off helper: probe every MP3 in the source folder, cache the duration
 * in seconds. Used by dw-parse-ocr.ts to cross-validate OCR'd track numbers
 * (a long-dialog Text page must map to a long-duration track).
 *
 * Output (gitignored):
 *   scripts/transcriptions/_audio-durations.json
 *     { "01": 14.65, "02": 241.24, … }
 *
 * Run:
 *   npx tsx scripts/dw-audio-durations.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const AUDIO_DIR = path.join(process.cwd(), "public", "audio", "B1 listening mp3");
const FILE_PREFIX = "Dt_ueben_Hoeren_Sprechen_B1_Track_";
const OUT_PATH = path.join(
  process.cwd(),
  "scripts",
  "transcriptions",
  "_audio-durations.json",
);

function probeDurationSec(file: string): number {
  if (!ffmpegPath) throw new Error("ffmpeg-static not resolved");
  // ffmpeg writes "Duration: HH:MM:SS.SS" to stderr.
  const output = execFileSync(ffmpegPath, ["-i", file, "-f", "null", "-"], {
    encoding: "utf-8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  // execFileSync returns stdout by default; we read stderr via shell catch:
  return parseDurationFromStderr(file, output);
}

function parseDurationFromStderr(file: string, _output: string): number {
  // Fallback: spawn ffmpeg manually and grep stderr.
  const child = require("node:child_process").spawnSync(ffmpegPath, [
    "-i",
    file,
    "-f",
    "null",
    "-",
  ]);
  const stderr = (child.stderr ?? Buffer.from("")).toString("utf-8");
  const m = stderr.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}\.\d+)/);
  if (!m) throw new Error(`Can't parse duration for ${file}`);
  const [, h, mm, ss] = m;
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss);
}

async function main() {
  if (!fs.existsSync(AUDIO_DIR)) {
    console.error(`❌ Audio dir not found: ${AUDIO_DIR}`);
    process.exit(1);
  }
  const out: Record<string, number> = {};
  for (let i = 1; i <= 55; i++) {
    const tag = String(i).padStart(2, "0");
    const file = path.join(AUDIO_DIR, `${FILE_PREFIX}${tag}.mp3`);
    if (!fs.existsSync(file)) {
      console.warn(`⚠ missing ${file}`);
      continue;
    }
    const dur = probeDurationSec(file);
    out[tag] = +dur.toFixed(2);
    process.stdout.write(`\rprobed ${tag}/55 (${out[tag]}s)         `);
  }
  process.stdout.write("\n");
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log(`✅ Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
