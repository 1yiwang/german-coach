import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  documents: defineTable({
    title: v.string(),
    source: v.optional(v.string()),
    level: v.optional(v.string()),
    totalSentences: v.number(),
    progress: v.number(),
    createdAt: v.number(),
  }),

  sentences: defineTable({
    documentId: v.id("documents"),
    index: v.number(),
    original: v.string(),
    translation: v.optional(v.string()),
    grammar: v.optional(v.string()),
    vocab: v.optional(v.array(v.object({
      word: v.string(),
      meaning: v.string(),
    }))),
    explanation: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    mastery: v.number(),
  }).index("by_document_index", ["documentId", "index"]),

  practiceHistory: defineTable({
    sentenceId: v.id("sentences"),
    type: v.union(
      v.literal("rewrite"),
      v.literal("compose"),
      v.literal("fill_blank"),
    ),
    userAnswer: v.string(),
    correctAnswer: v.optional(v.string()),
    feedback: v.string(),
    passed: v.boolean(),
    createdAt: v.number(),
  }).index("by_sentence", ["sentenceId"]),

  conversations: defineTable({
    scenario: v.string(),
    level: v.string(),
    messages: v.array(v.object({
      role: v.union(v.literal("ai"), v.literal("user")),
      content: v.string(),
      correction: v.optional(v.string()),
      newWords: v.optional(v.array(v.string())),
    })),
    completed: v.boolean(),
    createdAt: v.number(),
  }),

  scenarios: defineTable({
    title: v.string(),
    level: v.string(),
    category: v.string(),
    systemPrompt: v.string(),
    unlockAfter: v.array(v.string()),
  }),

  words: defineTable({
    word: v.string(),
    definition: v.string(),
    exampleSentence: v.optional(v.string()),
    source: v.union(v.literal("reading"), v.literal("chat")),
    sourceRef: v.optional(v.string()),

    ease: v.number(),
    interval: v.number(),
    repetitions: v.number(),
    nextReview: v.number(),
    lastReview: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_word", ["word"])
    .index("by_next_review", ["nextReview"]),

  reviewLog: defineTable({
    wordId: v.id("words"),
    quality: v.number(),
    responseTime: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_word", ["wordId"]),

  dailyStats: defineTable({
    date: v.string(),
    newWordsLearned: v.number(),
    reviewsDone: v.number(),
    exercisesDone: v.number(),
    chatMessages: v.number(),
    accuracy: v.number(),
    streak: v.number(),
  }).index("by_date", ["date"]),
});
