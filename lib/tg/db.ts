import { createClient } from "@supabase/supabase-js";

export type TgDueItemType = "word" | "sentence";

export interface TgSubscriberInput {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface TgSubscriber {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface TgDueWord {
  type: "word";
  id: string;
  title: string;
  definition: string;
  example?: string;
  sourceRef?: string;
  nextReview: number;
  reviewUrl: string;
}

export interface TgDueSentence {
  type: "sentence";
  id: string;
  title: string;
  sentence: string;
  documentTitle: string;
  documentId: string;
  sentenceIndex: number;
  nextReview: number;
  reviewUrl: string;
}

export type TgDueItem = TgDueWord | TgDueSentence;

interface DbWord {
  id: string;
  word: string;
  definition: string;
  example_sentence: string | null;
  source_ref: string | null;
  next_review: string;
}

interface DbSentenceProgress {
  sentence_id: string;
  next_review: string;
  status: "new" | "learning" | "mastered" | "skipped";
}

interface DbSentence {
  id: string;
  document_id: string;
  index: number;
  original: string;
  documents:
    | {
        id: string;
        title: string;
      }
    | {
        id: string;
        title: string;
      }[]
    | null;
}

const APP_BASE_URL =
  process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toMillis(iso: string): number {
  return new Date(iso).getTime();
}

function reviewUrlForWord(wordId: string): string {
  // /review does not yet deep-link to a specific card. Keep the id in the
  // URL so the future implementation can use it without changing Telegram.
  return `${APP_BASE_URL}/review?card=${encodeURIComponent(wordId)}`;
}

function reviewUrlForSentence(documentId: string, sentenceId: string): string {
  return `${APP_BASE_URL}/listen?id=${encodeURIComponent(
    documentId,
  )}&jump=${encodeURIComponent(sentenceId)}`;
}

export async function upsertSubscriber(input: TgSubscriberInput): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await sb().from("tg_subscribers").upsert(
    {
      chat_id: input.chatId,
      username: input.username ?? null,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      is_active: true,
      last_seen_at: now,
    },
    { onConflict: "chat_id" },
  );
  if (error) throw error;
}

export async function listActiveSubscribers(): Promise<TgSubscriber[]> {
  const { data, error } = await sb()
    .from("tg_subscribers")
    .select("chat_id, username, first_name, last_name")
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    chatId: Number(row.chat_id),
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
  }));
}

export async function getDueItems(now: Date = new Date()): Promise<TgDueItem[]> {
  const db = sb();
  const nowIso = now.toISOString();

  const { data: wordRows, error: wErr } = await db
    .from("words")
    .select("id, word, definition, example_sentence, source_ref, next_review")
    .lte("next_review", nowIso)
    .order("next_review", { ascending: true });
  if (wErr) throw wErr;

  const words: TgDueWord[] = ((wordRows ?? []) as DbWord[]).map((w) => ({
    type: "word",
    id: w.id,
    title: w.word,
    definition: w.definition,
    example: w.example_sentence ?? undefined,
    sourceRef: w.source_ref ?? undefined,
    nextReview: toMillis(w.next_review),
    reviewUrl: reviewUrlForWord(w.id),
  }));

  const { data: progressRows, error: pErr } = await db
    .from("sentence_progress")
    .select("sentence_id, next_review, status")
    .lte("next_review", nowIso)
    .neq("status", "skipped")
    .order("next_review", { ascending: true });
  if (pErr) throw pErr;

  const progress = (progressRows ?? []) as DbSentenceProgress[];
  let sentences: TgDueSentence[] = [];
  if (progress.length > 0) {
    const sentenceIds = progress.map((p) => p.sentence_id);
    const progressById = new Map(progress.map((p) => [p.sentence_id, p]));
    const { data: sentenceRows, error: sErr } = await db
      .from("sentences")
      .select("id, document_id, index, original, documents(id, title)")
      .in("id", sentenceIds);
    if (sErr) throw sErr;

    sentences = ((sentenceRows ?? []) as unknown as DbSentence[]).map((s) => {
      const prog = progressById.get(s.id)!;
      const document = Array.isArray(s.documents)
        ? s.documents[0]
        : s.documents;
      const documentTitle = document?.title ?? "Hörverstehen";
      return {
        type: "sentence",
        id: s.id,
        title: `Satz ${s.index + 1}`,
        sentence: s.original,
        documentTitle,
        documentId: s.document_id,
        sentenceIndex: s.index,
        nextReview: toMillis(prog.next_review),
        reviewUrl: reviewUrlForSentence(s.document_id, s.id),
      };
    });
  }

  return [...words, ...sentences].sort((a, b) => a.nextReview - b.nextReview);
}

export async function wasSent(
  chatId: number,
  itemType: "summary" | TgDueItemType,
  itemId: string,
  windowKey: string,
): Promise<boolean> {
  const { data, error } = await sb()
    .from("notifications_log")
    .select("id")
    .eq("chat_id", chatId)
    .eq("item_type", itemType)
    .eq("item_id", itemId)
    .eq("window_key", windowKey)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function markSent(
  chatId: number,
  itemType: "summary" | TgDueItemType,
  itemId: string,
  windowKey: string,
): Promise<void> {
  const { error } = await sb().from("notifications_log").upsert(
    {
      chat_id: chatId,
      item_type: itemType,
      item_id: itemId,
      window_key: windowKey,
    },
    { onConflict: "chat_id,item_type,item_id,window_key" },
  );
  if (error) throw error;
}

export async function filterUnsentItems(
  chatId: number,
  items: TgDueItem[],
  windowKey: string,
): Promise<TgDueItem[]> {
  const kept: TgDueItem[] = [];
  for (const item of items) {
    if (!(await wasSent(chatId, item.type, item.id, windowKey))) {
      kept.push(item);
    }
  }
  return kept;
}
