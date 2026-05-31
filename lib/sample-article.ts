/**
 * v0.1 hard-coded reading material — Menschen B1 style.
 *
 * Once PDF upload + LLM segmentation ships in v0.2, this file is replaced by
 * Convex documents/sentences tables and a real upload flow.
 */

export interface SampleSentence {
  /**
   * Supabase `sentences.id` (uuid). Present for real DB-backed sentences;
   * absent for the hard-coded demo article — the /listen rating buttons
   * gate themselves on this field so demo sentences show a disabled-state
   * hint instead of writing nowhere.
   */
  id?: string;
  index: number;
  original: string;
  translationHint?: string;
  grammarTag?: string;
  /** Real publisher audio URL; if absent, /listen falls back to browser TTS. */
  audioUrl?: string;
}

export interface SampleArticle {
  id: string;
  title: string;
  level: string;
  source: string;
  sentences: SampleSentence[];
}

export const sampleArticle: SampleArticle = {
  id: "menschen-b1-lektion-1",
  title: "Annas erster Tag im neuen Kurs",
  level: "B1",
  source: "v0.1 hard-coded sample (Menschen B1 style)",
  sentences: [
    {
      index: 0,
      original: "Anna hat gestern einen neuen Deutschkurs besucht.",
      translationHint: "Anna 昨天去上了一节新的德语课。",
      grammarTag: "Perfekt mit haben",
    },
    {
      index: 1,
      original: "Sie war ein bisschen nervös, weil sie niemanden kannte.",
      translationHint: "她有点紧张，因为她谁也不认识。",
      grammarTag: "Nebensatz mit weil",
    },
    {
      index: 2,
      original:
        "Die Lehrerin hat sich vorgestellt und alle Teilnehmer begrüßt.",
      translationHint: "老师作了自我介绍，并向所有学员问好。",
      grammarTag: "Reflexivverb sich vorstellen",
    },
    {
      index: 3,
      original:
        "Danach sollten alle einen kurzen Text über ihre Hobbys schreiben.",
      translationHint: "然后所有人都要写一段关于自己爱好的短文。",
      grammarTag: "Modalverb sollten im Präteritum",
    },
    {
      index: 4,
      original:
        "Anna hat geschrieben, dass sie gern wandert und kocht.",
      translationHint: "Anna 写道她喜欢徒步和做饭。",
      grammarTag: "Nebensatz mit dass",
    },
    {
      index: 5,
      original:
        "Ein junger Mann neben ihr hat ihren Text gelesen und gelächelt.",
      translationHint: "她旁边的一位年轻男士读了她的文字，笑了笑。",
      grammarTag: "Perfekt-Kette",
    },
    {
      index: 6,
      original: `\u201EIch wandere auch sehr gern\u201C, hat er gesagt. \u201EVielleicht gehen wir mal zusammen.\u201C`,
      translationHint:
        "「我也很喜欢徒步」，他说，「也许我们可以一起去走走。」",
      grammarTag: "Direkte Rede",
    },
    {
      index: 7,
      original:
        "Am Ende der Stunde haben sie ihre Telefonnummern ausgetauscht.",
      translationHint: "课程结束时他们交换了电话号码。",
      grammarTag: "trennbares Verb austauschen",
    },
    {
      index: 8,
      original:
        "Anna war froh, dass der erste Tag so freundlich verlaufen war.",
      translationHint: "Anna 很高兴第一天进行得这么友好。",
      grammarTag: "Plusquamperfekt mit war",
    },
  ],
};
