import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  calculateNextReview,
  type ReviewRating,
  type SrsState,
} from "@/lib/srs";

/**
 * SRS word-table queries / mutations.
 *
 * Boundary convention: Postgres uses timestamptz; the rest of the app
 * (`lib/srs.ts`, React components, /api/* routes) speaks in millis-since-epoch
 * `number`s. Conversion happens here and only here.
 */

export interface Word {
  id: string;
  word: string;
  definition: string;
  exampleSentence?: string;
  source: "reading" | "chat";
  sourceRef?: string;
  ease: number;
  interval: number;
  repetitions: number;
  nextReview: number;
  lastReview?: number;
  createdAt: number;
}

interface DbWord {
  id: string;
  word: string;
  definition: string;
  example_sentence: string | null;
  source: "reading" | "chat";
  source_ref: string | null;
  ease: number;
  interval: number;
  repetitions: number;
  next_review: string;
  last_review: string | null;
  created_at: string;
}

function toMillis(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  return new Date(iso).getTime();
}

function fromDbRow(row: DbWord): Word {
  return {
    id: row.id,
    word: row.word,
    definition: row.definition,
    exampleSentence: row.example_sentence ?? undefined,
    source: row.source,
    sourceRef: row.source_ref ?? undefined,
    ease: Number(row.ease),
    interval: row.interval,
    repetitions: row.repetitions,
    nextReview: toMillis(row.next_review)!,
    lastReview: toMillis(row.last_review),
    createdAt: toMillis(row.created_at)!,
  };
}

export async function dueForReview(now: number = Date.now()): Promise<Word[]> {
  const { data, error } = await supabaseAdmin()
    .from("words")
    .select("*")
    .lte("next_review", new Date(now).toISOString())
    .order("next_review", { ascending: true });
  if (error) throw error;
  return (data as DbWord[]).map(fromDbRow);
}

export async function dueCount(now: number = Date.now()): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("words")
    .select("*", { count: "exact", head: true })
    .lte("next_review", new Date(now).toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function listAll(): Promise<Word[]> {
  const { data, error } = await supabaseAdmin()
    .from("words")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as DbWord[]).map(fromDbRow);
}

export interface AddWordInput {
  word: string;
  definition: string;
  exampleSentence?: string;
  source: "reading" | "chat";
  sourceRef?: string;
}

export async function addWord(input: AddWordInput): Promise<string> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("words")
    .select("id")
    .eq("word", input.word)
    .maybeSingle();
  if (existing) return existing.id as string;

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("words")
    .insert({
      word: input.word,
      definition: input.definition,
      example_sentence: input.exampleSentence ?? null,
      source: input.source,
      source_ref: input.sourceRef ?? null,
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      next_review: now,
      created_at: now,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export interface RecordReviewInput {
  wordId: string;
  rating: ReviewRating;
  responseTime?: number;
}

export interface RecordReviewResult {
  ease: number;
  interval: number;
  repetitions: number;
  nextReview: number;
  lastReview: number;
}

/**
 * Trust-no-client SRS write path: server reads current state, computes the
 * next SM-2 state via `lib/srs.ts`, then atomically patches `words` and
 * inserts into `review_log`. The client only sends the rating, never the
 * computed numbers, so a tampered client can't shove arbitrary intervals in.
 */
export async function recordReview(
  input: RecordReviewInput,
): Promise<RecordReviewResult> {
  const sb = supabaseAdmin();

  const { data: row, error: readErr } = await sb
    .from("words")
    .select("ease, interval, repetitions, next_review, last_review")
    .eq("id", input.wordId)
    .single();
  if (readErr) throw readErr;

  const current: SrsState = {
    ease: Number(row.ease),
    interval: row.interval,
    repetitions: row.repetitions,
    nextReview: toMillis(row.next_review)!,
    lastReview: toMillis(row.last_review),
  };

  const now = Date.now();
  const next = calculateNextReview(current, input.rating, now);
  const quality =
    input.rating === "again"
      ? 1
      : input.rating === "hard"
        ? 3
        : input.rating === "good"
          ? 4
          : 5;

  const { error: patchErr } = await sb
    .from("words")
    .update({
      ease: next.ease,
      interval: next.interval,
      repetitions: next.repetitions,
      next_review: new Date(next.nextReview).toISOString(),
      last_review: new Date(now).toISOString(),
    })
    .eq("id", input.wordId);
  if (patchErr) throw patchErr;

  const { error: logErr } = await sb.from("review_log").insert({
    word_id: input.wordId,
    quality,
    response_time: input.responseTime ?? null,
  });
  if (logErr) throw logErr;

  return {
    ease: next.ease,
    interval: next.interval,
    repetitions: next.repetitions,
    nextReview: next.nextReview,
    lastReview: now,
  };
}
