import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  calculateNextReview,
  initialSrsState,
  WordStatus,
  type ReviewRating,
  type SrsState,
} from "@/lib/srs";

/**
 * Per-sentence SRS progress for the /listen shadowing flow.
 *
 * Schema: see supabase/migrations/0002_sentence_progress.sql.
 *
 * Boundary convention (same as lib/db/words.ts): Postgres uses
 * timestamptz; the rest of the app speaks millis-since-epoch numbers,
 * and lib/srs.ts is the single SM-2 implementation. Conversion happens
 * here and only here.
 *
 * The 6-level WordStatus enum from lib/srs.ts is collapsed into a
 * 3-state SentenceStatus string at write time so the upcoming library
 * grid (Step 2) can SELECT count(*) WHERE status = 'mastered' without
 * touching SM-2 internals.
 */

export type SentenceStatus = "new" | "learning" | "mastered" | "skipped";

/**
 * Sentinel `next_review` for skipped sentences: ~100 years from "now"
 * so the Telegram bot's `next_review <= now()` query never picks them
 * up even if a future scheduler bypasses the status check.
 */
function skipSentinelNextReview(): number {
  return Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
}

export interface SentenceProgress {
  sentenceId: string;
  ease: number;
  interval: number;
  repetitions: number;
  nextReview: number;
  lastReview?: number;
  status: SentenceStatus;
}

interface DbRow {
  sentence_id: string;
  ease: string | number;
  interval: number;
  repetitions: number;
  next_review: string;
  last_review: string | null;
  status: SentenceStatus;
}

function toMillis(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  return new Date(iso).getTime();
}

function fromDbRow(row: DbRow): SentenceProgress {
  return {
    sentenceId: row.sentence_id,
    ease: Number(row.ease),
    interval: row.interval,
    repetitions: row.repetitions,
    nextReview: toMillis(row.next_review)!,
    lastReview: toMillis(row.last_review),
    status: row.status,
  };
}

function deriveStatus(wordStatus: WordStatus): SentenceStatus {
  if (wordStatus === WordStatus.WellKnown) return "mastered";
  if (wordStatus === WordStatus.New) return "new";
  return "learning";
}

export async function getSentenceProgress(
  sentenceId: string,
): Promise<SentenceProgress | null> {
  const { data, error } = await supabaseAdmin()
    .from("sentence_progress")
    .select("*")
    .eq("sentence_id", sentenceId)
    .maybeSingle();
  if (error) throw error;
  return data ? fromDbRow(data as DbRow) : null;
}

/**
 * Per-document aggregate for the /listen library grid (S2 · 🏰 BOSS
 * map). One Supabase round-trip via a nested SELECT that inner-joins
 * sentence_progress → sentences so each progress row carries its
 * document_id; we then fold the rows into per-doc counts in JS.
 *
 * `total` is taken from `documents.total_sentences` (set at import
 * time, never mutated) rather than re-counting sentences, so callers
 * must hand in the doc list they want stats for. Documents with no
 * graded sentences yet still get a stats row (all zeros) so the grid
 * can render them as 🏚️ unexplored.
 */
export interface LibraryDocStat {
  documentId: string;
  total: number;
  newCount: number;
  learningCount: number;
  masteredCount: number;
  skippedCount: number;
  dueCount: number;
  lastReviewedAt?: number;
}

export async function listLibraryStats(
  docs: { id: string; totalSentences: number }[],
): Promise<LibraryDocStat[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("sentence_progress")
    .select("status, next_review, last_review, sentences!inner(document_id)");
  if (error) throw error;

  const now = Date.now();
  const byDoc = new Map<string, LibraryDocStat>();
  for (const doc of docs) {
    byDoc.set(doc.id, {
      documentId: doc.id,
      total: doc.totalSentences,
      newCount: doc.totalSentences,
      learningCount: 0,
      masteredCount: 0,
      skippedCount: 0,
      dueCount: 0,
    });
  }

  type Row = {
    status: SentenceStatus;
    next_review: string;
    last_review: string | null;
    sentences:
      | { document_id: string }
      | { document_id: string }[]
      | null;
  };

  for (const row of (data ?? []) as Row[]) {
    // Supabase nested selects can come back as either a single object
    // or an array depending on FK cardinality; sentence_progress.sentence_id
    // is 1:1 with sentences, but we still defensively unwrap both shapes.
    const link = Array.isArray(row.sentences) ? row.sentences[0] : row.sentences;
    if (!link) continue;
    const docId = link.document_id;
    const stat = byDoc.get(docId);
    if (!stat) continue;

    if (row.status === "learning") stat.learningCount++;
    else if (row.status === "mastered") stat.masteredCount++;
    else if (row.status === "skipped") stat.skippedCount++;

    if (row.status !== "skipped") {
      const nextMs = toMillis(row.next_review);
      if (nextMs !== undefined && nextMs <= now) stat.dueCount++;
    }

    const lastMs = toMillis(row.last_review);
    if (lastMs !== undefined) {
      stat.lastReviewedAt = Math.max(stat.lastReviewedAt ?? 0, lastMs);
    }
  }

  for (const stat of byDoc.values()) {
    stat.newCount = Math.max(
      0,
      stat.total -
        stat.learningCount -
        stat.masteredCount -
        stat.skippedCount,
    );
  }

  return Array.from(byDoc.values());
}

export async function listProgressForDocument(
  documentId: string,
): Promise<SentenceProgress[]> {
  // Joins through sentences to get only rows for this document. Used by
  // the library grid + the per-document `initialProgress` payload that
  // the listen Server Component passes to ListenClient.
  const sb = supabaseAdmin();
  const { data: sentenceIds, error: sErr } = await sb
    .from("sentences")
    .select("id")
    .eq("document_id", documentId);
  if (sErr) throw sErr;
  const ids = (sentenceIds ?? []).map((r) => r.id as string);
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("sentence_progress")
    .select("*")
    .in("sentence_id", ids);
  if (error) throw error;
  return (data as DbRow[]).map(fromDbRow);
}

export interface RecordSentenceReviewInput {
  sentenceId: string;
  rating: ReviewRating;
}

export interface RecordSentenceReviewResult {
  ease: number;
  interval: number;
  repetitions: number;
  nextReview: number;
  lastReview: number;
  status: SentenceStatus;
}

/**
 * Trust-no-client SRS write path: server reads current state (or
 * initialises if this sentence has never been rated), computes the
 * next SM-2 state via lib/srs.ts, then upserts back. Mirrors
 * lib/db/words.recordReview so the two flows stay symmetric.
 */
export async function recordSentenceReview(
  input: RecordSentenceReviewInput,
): Promise<RecordSentenceReviewResult> {
  const sb = supabaseAdmin();

  const { data: row, error: readErr } = await sb
    .from("sentence_progress")
    .select("ease, interval, repetitions, next_review, last_review")
    .eq("sentence_id", input.sentenceId)
    .maybeSingle();
  if (readErr) throw readErr;

  const current: SrsState = row
    ? {
        ease: Number(row.ease),
        interval: row.interval,
        repetitions: row.repetitions,
        nextReview: toMillis(row.next_review)!,
        lastReview: toMillis(row.last_review),
      }
    : initialSrsState();

  const now = Date.now();
  const next = calculateNextReview(current, input.rating, now);
  const status = deriveStatus(next.status);

  const { error: upsertErr } = await sb
    .from("sentence_progress")
    .upsert(
      {
        sentence_id: input.sentenceId,
        ease: next.ease,
        interval: next.interval,
        repetitions: next.repetitions,
        next_review: new Date(next.nextReview).toISOString(),
        last_review: new Date(now).toISOString(),
        status,
      },
      { onConflict: "sentence_id" },
    );
  if (upsertErr) throw upsertErr;

  return {
    ease: next.ease,
    interval: next.interval,
    repetitions: next.repetitions,
    nextReview: next.nextReview,
    lastReview: now,
    status,
  };
}

/**
 * Mark a sentence as "don't review" — useful for trivially easy
 * sentences the user doesn't want cluttering the SRS queue. Preserves
 * any prior ease/interval/repetitions so an unskip restores roughly
 * the previous learning state without wiping history.
 */
export async function skipSentence(
  sentenceId: string,
): Promise<SentenceProgress> {
  const sb = supabaseAdmin();

  const { data: row, error: readErr } = await sb
    .from("sentence_progress")
    .select("ease, interval, repetitions, last_review")
    .eq("sentence_id", sentenceId)
    .maybeSingle();
  if (readErr) throw readErr;

  const nextReviewMs = skipSentinelNextReview();
  const payload = {
    sentence_id: sentenceId,
    ease: row ? Number(row.ease) : 2.5,
    interval: row?.interval ?? 0,
    repetitions: row?.repetitions ?? 0,
    next_review: new Date(nextReviewMs).toISOString(),
    last_review: row?.last_review ?? null,
    status: "skipped" as const,
  };

  const { error: upsertErr } = await sb
    .from("sentence_progress")
    .upsert(payload, { onConflict: "sentence_id" });
  if (upsertErr) throw upsertErr;

  return {
    sentenceId,
    ease: payload.ease,
    interval: payload.interval,
    repetitions: payload.repetitions,
    nextReview: nextReviewMs,
    lastReview: toMillis(payload.last_review),
    status: "skipped",
  };
}

/**
 * Reverse `skipSentence`: pull the sentence back into the queue. We
 * delete the row entirely rather than ratcheting status back to
 * 'new' so the sentence reverts to "never rated" — clean restart.
 * (If the user wants to keep their pre-skip stats, the UX hint is
 * to grade it again rather than unskip.)
 */
export async function unskipSentence(sentenceId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("sentence_progress")
    .delete()
    .eq("sentence_id", sentenceId);
  if (error) throw error;
}
