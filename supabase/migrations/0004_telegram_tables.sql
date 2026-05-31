-- 0004 — Telegram reminder MVP
--
-- Stores the Telegram chats that opted in via /start and a send log so
-- scheduled reminder windows do not duplicate messages. RLS remains off
-- by project convention: all writes happen through server-side scripts /
-- service_role only.

create table public.tg_subscribers (
  id              uuid primary key default uuid_generate_v4(),
  chat_id         bigint not null unique,
  username        text,
  first_name      text,
  last_name       text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index tg_subscribers_active_idx
  on public.tg_subscribers(is_active);

create table public.notifications_log (
  id            uuid primary key default uuid_generate_v4(),
  chat_id       bigint not null,
  item_type     text not null check (item_type in ('summary', 'word', 'sentence')),
  item_id       text not null,
  window_key    text not null,
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (chat_id, item_type, item_id, window_key)
);

create index notifications_log_window_idx
  on public.notifications_log(window_key);
create index notifications_log_chat_window_idx
  on public.notifications_log(chat_id, window_key);
