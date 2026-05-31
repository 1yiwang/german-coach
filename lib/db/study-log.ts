import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ReviewRating } from "@/lib/srs";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const STUDY_TIME_ZONE = "Europe/Berlin";

export interface StudyLogDay {
  date: string;
  effortScore: number;
  sentencesStudied: number;
  sentencesMastered: number;
  reviewsCompleted: number;
  articlesCompleted: number;
}

interface DbStudyLogRow {
  log_date: string;
  effort_score: number;
  sentences_studied: number;
  sentences_mastered: number;
  reviews_completed: number;
  articles_completed: number;
}

function toBerlinDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function fromDbRow(row: DbStudyLogRow): StudyLogDay {
  return {
    date: row.log_date,
    effortScore: row.effort_score,
    sentencesStudied: row.sentences_studied,
    sentencesMastered: row.sentences_mastered,
    reviewsCompleted: row.reviews_completed,
    articlesCompleted: row.articles_completed,
  };
}

function effortForSentenceRating(rating: ReviewRating): {
  effortScore: number;
  sentencesMastered: number;
} {
  if (rating === "again" || rating === "hard") {
    // Difficult reviews are valuable; reward the work without pretending
    // the sentence is mastered.
    return { effortScore: 3, sentencesMastered: 0 };
  }
  return { effortScore: 2, sentencesMastered: 1 };
}

export async function recordSentenceStudyEvent(
  rating: ReviewRating,
): Promise<StudyLogDay> {
  const logDate = toBerlinDateKey();
  const delta = effortForSentenceRating(rating);
  const sb = supabaseAdmin();

  const { data: existing, error: readErr } = await sb
    .from("study_log")
    .select(
      "log_date, effort_score, sentences_studied, sentences_mastered, reviews_completed, articles_completed",
    )
    .eq("user_id", DEFAULT_USER_ID)
    .eq("log_date", logDate)
    .maybeSingle();
  if (readErr) throw readErr;

  const next = {
    user_id: DEFAULT_USER_ID,
    log_date: logDate,
    effort_score: (existing?.effort_score ?? 0) + delta.effortScore,
    sentences_studied: (existing?.sentences_studied ?? 0) + 1,
    sentences_mastered:
      (existing?.sentences_mastered ?? 0) + delta.sentencesMastered,
    reviews_completed: (existing?.reviews_completed ?? 0) + 1,
    articles_completed: existing?.articles_completed ?? 0,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from("study_log")
    .upsert(next, { onConflict: "user_id,log_date" })
    .select(
      "log_date, effort_score, sentences_studied, sentences_mastered, reviews_completed, articles_completed",
    )
    .single();
  if (error) throw error;
  return fromDbRow(data as DbStudyLogRow);
}

export async function listRecentStudyLogDays(
  days = 90,
): Promise<StudyLogDay[]> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(days - 1, 0));

  const { data, error } = await supabaseAdmin()
    .from("study_log")
    .select(
      "log_date, effort_score, sentences_studied, sentences_mastered, reviews_completed, articles_completed",
    )
    .eq("user_id", DEFAULT_USER_ID)
    .gte("log_date", toBerlinDateKey(start))
    .lte("log_date", toBerlinDateKey(end))
    .order("log_date", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as DbStudyLogRow[]).map(fromDbRow);
}
