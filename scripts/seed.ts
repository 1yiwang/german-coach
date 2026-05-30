/**
 * Seed v0.2.5 demo content into Supabase. Idempotent: clears the four target
 * tables first (in FK-safe order), then inserts 1 document + 9 sentences + 4
 * demo SRS words.
 *
 * Run: `npm run seed`
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sentences = [
  {
    original: "Anna hat gestern einen neuen Deutschkurs besucht.",
    translation: "Anna 昨天去上了一节新的德语课。",
    grammar: "Perfekt mit haben",
  },
  {
    original: "Sie war ein bisschen nervös, weil sie niemanden kannte.",
    translation: "她有点紧张，因为她谁也不认识。",
    grammar: "Nebensatz mit weil",
  },
  {
    original:
      "Die Lehrerin hat sich vorgestellt und alle Teilnehmer begrüßt.",
    translation: "老师作了自我介绍，并向所有学员问好。",
    grammar: "Reflexivverb sich vorstellen",
  },
  {
    original:
      "Danach sollten alle einen kurzen Text über ihre Hobbys schreiben.",
    translation: "然后所有人都要写一段关于自己爱好的短文。",
    grammar: "Modalverb sollten im Präteritum",
  },
  {
    original: "Anna hat geschrieben, dass sie gern wandert und kocht.",
    translation: "Anna 写道她喜欢徒步和做饭。",
    grammar: "Nebensatz mit dass",
  },
  {
    original:
      "Ein junger Mann neben ihr hat ihren Text gelesen und gelächelt.",
    translation: "她旁边的一位年轻男士读了她的文字，笑了笑。",
    grammar: "Perfekt-Kette",
  },
  {
    original:
      "\u201EIch wandere auch sehr gern\u201C, hat er gesagt. \u201EVielleicht gehen wir mal zusammen.\u201C",
    translation: "「我也很喜欢徒步」，他说，「也许我们可以一起去走走。」",
    grammar: "Direkte Rede",
  },
  {
    original:
      "Am Ende der Stunde haben sie ihre Telefonnummern ausgetauscht.",
    translation: "课程结束时他们交换了电话号码。",
    grammar: "trennbares Verb austauschen",
  },
  {
    original:
      "Anna war froh, dass der erste Tag so freundlich verlaufen war.",
    translation: "Anna 很高兴第一天进行得这么友好。",
    grammar: "Plusquamperfekt mit war",
  },
];

const demoWords = [
  {
    word: "besuchen",
    definition: "v. 拜访 / 参加（课程、活动）",
    example_sentence: "Anna hat gestern einen neuen Deutschkurs besucht.",
  },
  {
    word: "nervös",
    definition: "adj. 紧张的、神经质的",
    example_sentence: "Sie war ein bisschen nervös.",
  },
  {
    word: "vorstellen",
    definition: "v. sich vorstellen 自我介绍 / vorstellen 介绍、设想",
    example_sentence: "Die Lehrerin hat sich vorgestellt.",
  },
  {
    word: "austauschen",
    definition: "v. trennbar 交换",
    example_sentence: "Sie haben ihre Telefonnummern ausgetauscht.",
  },
];

async function clearTable(name: string) {
  // delete all rows; using a "true" filter via a column that exists everywhere
  const { error } = await sb.from(name).delete().not("id", "is", null);
  if (error) throw new Error(`failed to clear ${name}: ${error.message}`);
}

async function main() {
  console.log("clearing review_log, words, sentences, documents...");
  await clearTable("review_log");
  await clearTable("words");
  await clearTable("sentences");
  await clearTable("documents");

  console.log("inserting sample document...");
  const { data: docRow, error: docErr } = await sb
    .from("documents")
    .insert({
      title: "Annas erster Tag im neuen Kurs",
      source: "v0.2.5 hard-coded sample (Menschen B1 style)",
      level: "B1",
      total_sentences: sentences.length,
      progress: 0,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const documentId = docRow.id as string;

  console.log(`inserting ${sentences.length} sentences...`);
  const sentenceRows = sentences.map((s, i) => ({
    document_id: documentId,
    index: i,
    original: s.original,
    translation: s.translation,
    grammar: s.grammar,
    mastery: 0,
  }));
  const { error: sErr } = await sb.from("sentences").insert(sentenceRows);
  if (sErr) throw sErr;

  console.log(`inserting ${demoWords.length} demo SRS words...`);
  const now = new Date().toISOString();
  const wordRows = demoWords.map((w) => ({
    word: w.word,
    definition: w.definition,
    example_sentence: w.example_sentence,
    source: "reading" as const,
    source_ref: "menschen-b1-lektion-1",
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    next_review: now,
  }));
  const { error: wErr } = await sb.from("words").insert(wordRows);
  if (wErr) throw wErr;

  console.log(
    `done. documents=1, sentences=${sentences.length}, words=${demoWords.length}`,
  );
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
