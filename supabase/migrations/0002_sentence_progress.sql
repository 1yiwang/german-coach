-- 0002 — per-sentence SRS progress for /listen
--
-- Mirrors the SRS-relevant subset of public.words so that lib/srs.ts
-- (SM-2) is the single algorithm shared between word-level review and
-- sentence-level review. The 6-level WordStatus enum from lib/srs.ts is
-- mapped down to a derived 3-state string here ('new' | 'learning' |
-- 'mastered') for fast aggregation on the upcoming library grid
-- (Step 2). The mapping itself lives in lib/db/listen-progress.ts.
--
-- Single-user MVP: sentence_id is the primary key. user_id is reserved
-- as a column so we can move to a composite PK without rewriting the
-- API surface when (if) we go multi-user.
--
-- Run order: paste this into Supabase Dashboard -> SQL Editor after
-- 0001_init.sql.

create table public.sentence_progress (
  sentence_id   uuid primary key references public.sentences(id) on delete cascade,
  user_id       uuid not null default '00000000-0000-0000-0000-000000000001',
  ease          numeric not null default 2.5,
  interval      integer not null default 0,
  repetitions   integer not null default 0,
  next_review   timestamptz not null default now(),
  last_review   timestamptz,
  status        text    not null default 'new'
                check (status in ('new', 'learning', 'mastered')),
  created_at    timestamptz not null default now()
);

create index sentence_progress_next_review_idx
  on public.sentence_progress(next_review);
create index sentence_progress_status_idx
  on public.sentence_progress(status);
