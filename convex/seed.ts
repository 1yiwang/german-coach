import { mutation } from "./_generated/server";

/**
 * Seed v0.1 demo content into Convex. Idempotent: re-running clears the
 * existing seed first. Call from the Convex dashboard or `npx convex run seed:run`.
 */
export const run = mutation({
  args: {},
  handler: async (ctx) => {
    // Clear existing data.
    const oldWords = await ctx.db.query("words").collect();
    for (const w of oldWords) await ctx.db.delete(w._id);
    const oldReviews = await ctx.db.query("reviewLog").collect();
    for (const r of oldReviews) await ctx.db.delete(r._id);
    const oldSentences = await ctx.db.query("sentences").collect();
    for (const s of oldSentences) await ctx.db.delete(s._id);
    const oldDocs = await ctx.db.query("documents").collect();
    for (const d of oldDocs) await ctx.db.delete(d._id);

    const now = Date.now();

    // Seed the Menschen B1 sample article (mirrors lib/sample-article.ts).
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

    const documentId = await ctx.db.insert("documents", {
      title: "Annas erster Tag im neuen Kurs",
      source: "v0.1 hard-coded sample (Menschen B1 style)",
      level: "B1",
      totalSentences: sentences.length,
      progress: 0,
      createdAt: now,
    });
    for (let i = 0; i < sentences.length; i++) {
      await ctx.db.insert("sentences", {
        documentId,
        index: i,
        original: sentences[i].original,
        translation: sentences[i].translation,
        grammar: sentences[i].grammar,
        mastery: 0,
      });
    }

    // Seed 4 demo SRS words (matches the earlier hard-coded list in /review).
    const demoWords = [
      {
        word: "besuchen",
        definition: "v. 拜访 / 参加（课程、活动）",
        example: "Anna hat gestern einen neuen Deutschkurs besucht.",
      },
      {
        word: "nervös",
        definition: "adj. 紧张的、神经质的",
        example: "Sie war ein bisschen nervös.",
      },
      {
        word: "vorstellen",
        definition: "v. sich vorstellen 自我介绍 / vorstellen 介绍、设想",
        example: "Die Lehrerin hat sich vorgestellt.",
      },
      {
        word: "austauschen",
        definition: "v. trennbar 交换",
        example: "Sie haben ihre Telefonnummern ausgetauscht.",
      },
    ];
    for (const w of demoWords) {
      await ctx.db.insert("words", {
        word: w.word,
        definition: w.definition,
        exampleSentence: w.example,
        source: "reading",
        sourceRef: "menschen-b1-lektion-1",
        ease: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: now,
        createdAt: now,
      });
    }

    return {
      documentId,
      sentenceCount: sentences.length,
      wordCount: demoWords.length,
    };
  },
});
