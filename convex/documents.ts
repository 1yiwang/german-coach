import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("documents").order("desc").collect();
  },
});

export const getWithSentences = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const sentences = await ctx.db
      .query("sentences")
      .withIndex("by_document_index", (q) => q.eq("documentId", args.documentId))
      .order("asc")
      .collect();
    return { doc, sentences };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    source: v.optional(v.string()),
    level: v.optional(v.string()),
    sentences: v.array(
      v.object({
        original: v.string(),
        translation: v.optional(v.string()),
        grammar: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const documentId = await ctx.db.insert("documents", {
      title: args.title,
      source: args.source,
      level: args.level,
      totalSentences: args.sentences.length,
      progress: 0,
      createdAt: now,
    });
    for (let i = 0; i < args.sentences.length; i++) {
      const s = args.sentences[i];
      await ctx.db.insert("sentences", {
        documentId,
        index: i,
        original: s.original,
        translation: s.translation,
        grammar: s.grammar,
        mastery: 0,
      });
    }
    return documentId;
  },
});
