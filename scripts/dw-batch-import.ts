/**
 * Batch driver: read _parsed.json (from dw-parse-ocr.ts), filter long-dialog
 * (a) parts, and run importOne() for each track.
 *
 * Prerequisites:
 *   1. npx tsx scripts/dw-pdf-extract.ts   (OCR the PDF)
 *   2. npx tsx scripts/dw-parse-ocr.ts     (parse into _parsed.json)
 *   3. MP3s in public/audio/B1 listening mp3/
 *
 * Run:
 *   npx tsx scripts/dw-batch-import.ts
 *   npx tsx scripts/dw-batch-import.ts --tracks 5,48
 *   SKIP_DB=1 npx tsx scripts/dw-batch-import.ts --tracks 5
 *   npx tsx scripts/dw-batch-import.ts --dry-run
 */

import { config } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { importOne } from "./dw-import";

config({ path: path.resolve(process.cwd(), ".env.local") });

const baseDir = process.cwd();
const parsedPath = path.join(
  baseDir,
  "scripts",
  "transcriptions",
  "_parsed.json",
);
const mp3Dir = path.join(baseDir, "public", "audio", "B1 listening mp3");
const MP3_PREFIX = "Dt_ueben_Hoeren_Sprechen_B1_Track_";

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

function mp3ForTrack(trackNum: number): string {
  const tag = String(trackNum).padStart(2, "0");
  return path.join(mp3Dir, `${MP3_PREFIX}${tag}.mp3`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const skipDb =
    process.env.SKIP_DB === "1" || process.argv.includes("--skip-db");
  const tracksIdx = process.argv.indexOf("--tracks");
  const trackFilter =
    tracksIdx >= 0
      ? new Set(
          process.argv[tracksIdx + 1]
            ?.split(",")
            .map((s) => Number(s.trim()))
            .filter(Boolean),
        )
      : null;

  if (!fs.existsSync(parsedPath)) {
    console.error(`❌ Missing ${parsedPath}`);
    console.error(`   Run: npx tsx scripts/dw-parse-ocr.ts first.`);
    process.exit(1);
  }

  const all = JSON.parse(
    fs.readFileSync(parsedPath, "utf-8"),
  ) as ParsedEntry[];
  const longDialogs = all.filter((e) => e.part === "a");
  const todo = trackFilter
    ? longDialogs.filter((e) => trackFilter.has(e.trackNumber))
    : longDialogs;

  console.log(`📋 ${todo.length} long-dialog tracks to import`);
  if (dryRun) {
    for (const e of todo) {
      const mp3 = mp3ForTrack(e.trackNumber);
      const exists = fs.existsSync(mp3);
      console.log(
        `  Track ${String(e.trackNumber).padStart(2)}  ${e.slug}` +
          `  ${e.wordCount}w  mp3=${exists ? "✓" : "✗"}` +
          `  "${e.title}"`,
      );
    }
    return;
  }

  const results: {
    track: number;
    slug: string;
    ok: boolean;
    sentences?: number;
    error?: string;
  }[] = [];

  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    const mp3 = mp3ForTrack(e.trackNumber);
    console.log(
      `\n[${i + 1}/${todo.length}] Track ${e.trackNumber}: ${e.title}`,
    );
    if (!fs.existsSync(mp3)) {
      console.error(`   ❌ MP3 not found: ${mp3}`);
      results.push({
        track: e.trackNumber,
        slug: e.slug,
        ok: false,
        error: "MP3 not found",
      });
      continue;
    }
    try {
      const res = await importOne({
        slug: e.slug,
        mp3Path: mp3,
        text: e.text,
        meta: {
          title: e.title,
          level: "B1",
          source: `Deutsch üben Hören & Sprechen B1 — ${e.chapterLetter} ${e.chapterTitle}`,
        },
        skipDb,
        baseDir,
      });
      results.push({
        track: e.trackNumber,
        slug: e.slug,
        ok: true,
        sentences: res.sentenceCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ Failed: ${msg}`);
      results.push({
        track: e.trackNumber,
        slug: e.slug,
        ok: false,
        error: msg,
      });
    }
  }

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ ${ok.length} succeeded, ❌ ${fail.length} failed`);
  if (fail.length > 0) {
    console.log(`\nFailed tracks:`);
    for (const f of fail) {
      console.log(`  Track ${f.track} (${f.slug}): ${f.error}`);
    }
  }
  const summaryPath = path.join(
    baseDir,
    "scripts",
    "transcriptions",
    "_batch-results.json",
  );
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`📁 Summary → ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
