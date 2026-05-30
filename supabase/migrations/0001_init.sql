-- german-coach v0.2.5 — initial schema (migrated from convex/schema.ts).
-- Run order: this file once, then scripts/seed.ts.
--
-- Conventions:
--   * snake_case columns (Postgres idiom; the API/lib/db layer maps to camelCase JS)
--   * uuid primary keys via uuid_generate_v4()
--   * timestamptz for instants (not millis bigint); JS boundary in lib/db/* converts to/from millis
--   * indexes named <table>_<columns>_idx
--   * CHECK constraints for the small string-enum unions Convex modeled with v.union(v.literal(...))
--
-- RLS: we do NOT enable RLS in v0.2.5 because all DB access is server-side via
-- the service_role key (lib/supabase/server.ts marked `import "server-only"`).
-- The anon key is wired into the browser only for any future read-only public
-- queries; right now no policy grants it any access, so it cannot read or write.

create extension if not exists "uuid-ossp";

-- documents -------------------------------------------------------------------
create table public.documents (
  id                uuid primary key default uuid_generate_v4(),
  title             text not null,
  source            text,
  level             text,
  total_sentences   integer not null,
  progress          integer not null default 0,
  created_at        timestamptz not null default now()
);

-- sentences -------------------------------------------------------------------
create table public.sentences (
  id            uuid primary key default uuid_generate_v4(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  index         integer not null,
  original      text not null,
  translation   text,
  grammar       text,
  vocab         jsonb,
  explanation   text,
  audio_url     text,
  mastery       integer not null default 0
);
create index sentences_document_index_idx on public.sentences(document_id, index);

-- practice_history ------------------------------------------------------------
create table public.practice_history (
  id              uuid primary key default uuid_generate_v4(),
  sentence_id     uuid not null references public.sentences(id) on delete cascade,
  type            text not null check (type in ('rewrite', 'compose', 'fill_blank')),
  user_answer     text not null,
  correct_answer  text,
  feedback        text not null,
  passed          boolean not null,
  created_at      timestamptz not null default now()
);
create index practice_history_sentence_idx on public.practice_history(sentence_id);

-- conversations ---------------------------------------------------------------
create table public.conversations (
  id          uuid primary key default uuid_generate_v4(),
  scenario    text not null,
  level       text not null,
  messages    jsonb not null,
  completed   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- scenarios -------------------------------------------------------------------
create table public.scenarios (
  id              uuid primary key default uuid_generate_v4(),
  title           text not null,
  level           text not null,
  category        text not null,
  system_prompt   text not null,
  unlock_after    text[] not null default '{}'
);

-- words -----------------------------------------------------------------------
create table public.words (
  id                uuid primary key default uuid_generate_v4(),
  word              text not null unique,                   -- matches Convex by_word index (used for upsert lookup); review_log.word_id references id
  definition        text not null,
  example_sentence  text,
  source            text not null check (source in ('reading', 'chat')),
  source_ref        text,
  ease              numeric not null default 2.5,
  interval          integer not null default 0,
  repetitions       integer not null default 0,
  next_review       timestamptz not null,
  last_review       timestamptz,
  created_at        timestamptz not null default now()
);
create index words_next_review_idx on public.words(next_review);

-- review_log ------------------------------------------------------------------
create table public.review_log (
  id              uuid primary key default uuid_generate_v4(),
  word_id         uuid not null references public.words(id) on delete cascade,
  quality         integer not null,
  response_time   integer,
  created_at      timestamptz not null default now()
);
create index review_log_word_idx on public.review_log(word_id);

-- daily_stats -----------------------------------------------------------------
create table public.daily_stats (
  id                  uuid primary key default uuid_generate_v4(),
  date                date not null unique,
  new_words_learned   integer not null default 0,
  reviews_done        integer not null default 0,
  exercises_done      integer not null default 0,
  chat_messages       integer not null default 0,
  accuracy            numeric not null default 0,
  streak              integer not null default 0
);
create index daily_stats_date_idx on public.daily_stats(date);
