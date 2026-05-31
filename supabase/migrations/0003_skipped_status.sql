-- 0003 — allow users to exclude individual sentences from SRS
--
-- Adds a new 'skipped' status to sentence_progress.status. Skipped
-- sentences are upserted with next_review pushed ~100 years into the
-- future so the Telegram bot's "next_review <= now()" query never
-- surfaces them. The status itself is what the library grid + the
-- per-sentence badge use; the next_review field is just defence in
-- depth in case any future scheduler bypasses status.
--
-- Pattern: drop the existing CHECK constraint, recreate it with the
-- extra literal. PG doesn't support "ALTER ... ADD VALUE" for CHECK
-- the way it does for native enums.
--
-- Run order: paste this into Supabase Dashboard -> SQL Editor after
-- 0002_sentence_progress.sql.

alter table public.sentence_progress
  drop constraint sentence_progress_status_check;

alter table public.sentence_progress
  add constraint sentence_progress_status_check
  check (status in ('new', 'learning', 'mastered', 'skipped'));
