import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// SM-2 defaults match lib/srs.ts (kept in sync; ease floor 1.3, start ease 2.5).

export const dueForReview = query({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.now ?? Date.now();
    return await ctx.db
      .query("words")
      .withIndex("by_next_review", (q) => q.lte("nextReview", cutoff))
      .order("asc")
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("words").order("desc").collect();
  },
});

export const dueCount = query({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.now ?? Date.now();
    const due = await ctx.db
      .query("words")
      .withIndex("by_next_review", (q) => q.lte("nextReview", cutoff))
      .collect();
    return due.length;
  },
});

export const add = mutation({
  args: {
    word: v.string(),
    definition: v.string(),
    exampleSentence: v.optional(v.string()),
    source: v.union(v.literal("reading"), v.literal("chat")),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("words")
      .withIndex("by_word", (q) => q.eq("word", args.word))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("words", {
      word: args.word,
      definition: args.definition,
      exampleSentence: args.exampleSentence,
      source: args.source,
      sourceRef: args.sourceRef,
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      nextReview: now,
      createdAt: now,
    });
  },
});

export const recordReview = mutation({
  args: {
    wordId: v.id("words"),
    quality: v.number(),
    ease: v.number(),
    interval: v.number(),
    repetitions: v.number(),
    nextReview: v.number(),
    responseTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.wordId, {
      ease: args.ease,
      interval: args.interval,
      repetitions: args.repetitions,
      nextReview: args.nextReview,
      lastReview: now,
    });
    await ctx.db.insert("reviewLog", {
      wordId: args.wordId,
      quality: args.quality,
      responseTime: args.responseTime,
      createdAt: now,
    });
  },
});
