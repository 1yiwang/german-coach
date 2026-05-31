-- 0005 — Daily study log for the lightweight gamification layer
--
-- One row per user per local learning day. The app is still single-user,
-- so user_id keeps the same sentinel convention as sentence_progress.
-- Writes happen server-side through service_role only.

create table public.study_log (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null default '00000000-0000-0000-0000-000000000001',
  log_date            date not null,
  effort_score        int not null default 0,
  sentences_studied   int not null default 0,
  sentences_mastered  int not null default 0,
  reviews_completed   int not null default 0,
  articles_completed  int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, log_date)
);

create index study_log_user_date_idx
  on public.study_log(user_id, log_date desc);
