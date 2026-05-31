/**
 * Import a precomputed audio/text alignment (from scripts/align-audio.ts) into
 * Supabase as a `documents` row + N `sentences` rows. Each sentence gets the
 * relative public/audio path stored in `sentences.audio_url`, so /listen plays
 * the real chunk instead of falling back to browser TTS.
 *
 * Usage:
 *   tsx scripts/import-aligned.ts <slug>
 *
 * Example:
 *   tsx scripts/import-aligned.ts b1-track-48
 *
 * Idempotent: if a `documents` row with the same title already exists, it (and
 * its sentences via FK ON DELETE CASCADE) is deleted first.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}
const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface AlignmentFile {
  slug: string;
  title: string;
  level?: string;
  source?: string;
  audioPathPrefix: string;
  sentences: { audioFile: string; duration: number; text: string }[];
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: tsx scripts/import-aligned.ts <slug>");
    process.exit(1);
  }
  const alignPath = path.join(
    process.cwd(),
    "scripts",
    "alignments",
    `${slug}.json`,
  );
  if (!fs.existsSync(alignPath)) {
    console.error(`❌ Alignment not found: ${alignPath}`);
    console.error(`   Run: tsx scripts/align-audio.ts ${slug} first.`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(alignPath, "utf-8")) as AlignmentFile;

  console.log(`📂 Slug:     ${data.slug}`);
  console.log(`📘 Title:    ${data.title}`);
  console.log(`📊 Level:    ${data.level ?? "—"}`);
  console.log(`📚 Source:   ${data.source ?? "—"}`);
  console.log(`🎧 Sentences:${data.sentences.length}`);

  // 1) Delete any existing rows with this title so reruns are clean.
  console.log(`\n🧹 Removing any prior "${data.title}" rows…`);
  const { data: existing } = await sb
    .from("documents")
    .select("id")
    .eq("title", data.title);
  if (existing && existing.length > 0) {
    for (const row of existing) {
      // sentences FK doesn't cascade in the v0.2.5 schema, so delete children first.
      await sb.from("sentences").delete().eq("document_id", row.id);
      await sb.from("documents").delete().eq("id", row.id);
    }
    console.log(`   removed ${existing.length} prior document(s)`);
  } else {
    console.log(`   none to remove`);
  }

  // 2) Insert the document.
  console.log(`\n📥 Inserting document…`);
  const { data: docRow, error: docErr } = await sb
    .from("documents")
    .insert({
      title: data.title,
      source: data.source ?? null,
      level: data.level ?? null,
      total_sentences: data.sentences.length,
      progress: 0,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const documentId = docRow.id as string;
  console.log(`   id = ${documentId}`);

  // 3) Insert sentences. The grammar/translation columns stay null — those are
  //    filled later on demand by DeepSeek /api/analyze when the user clicks
  //    解析. We're only populating the structural fields here.
  console.log(`\n📥 Inserting ${data.sentences.length} sentences…`);
  const rows = data.sentences.map((s, i) => ({
    document_id: documentId,
    index: i,
    original: s.text,
    translation: null,
    grammar: null,
    audio_url: `${data.audioPathPrefix}${s.audioFile}`,
    mastery: 0,
  }));
  const { error: sErr } = await sb.from("sentences").insert(rows);
  if (sErr) throw sErr;

  console.log(`\n✅ Done.`);
  console.log(
    `   Open http://localhost:3000/listen → click "${data.title}" → ▶ plays real audio.`,
  );
}

main().catch((err) => {
  console.error("\n❌ import-aligned failed:", err);
  process.exit(1);
});
