-- 0035_notifications.sql
-- Notifications: one pipeline for every message the app sends a person. Today there is one kind, the daily reminder email
-- ('digest.incomplete_work'); approvals will add kinds ('approval.requested', 'approval.decided') without a schema change.
-- Backward compatible: new tables and one nullable column the previous code ignores.

-- Where a person is, so a reminder can arrive at 6am their time. Null until their browser first reports it.
alter table core.users add column time_zone text;

-- A person's choice, per kind of message and channel. No row means the default (on).
create table core.notification_preferences (
  user_id    uuid not null references core.users(id) on delete cascade,
  kind       text not null,
  channel    text not null default 'email' check (channel in ('email')),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

-- Everything the app sent or tried to send. The dedupe key (for example 'digest:2026-11-10') makes a retry or a second cron run
-- harmless: one row per person and key.
create table core.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  recipient_id uuid not null references core.users(id) on delete cascade,
  kind         text not null,
  channel      text not null default 'email' check (channel in ('email')),
  project_id   uuid references core.projects(id) on delete set null,   -- null when the message covers several projects
  payload      jsonb not null default '{}',
  dedupe_key   text not null,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  unique (recipient_id, dedupe_key)
);
create index notifications_recipient_idx on core.notifications (recipient_id, created_at desc);

-- The reminder stops after it has said the same thing about a project three times. This remembers what it last said (the
-- fingerprint of the project's next step) and how many times in a row; a project that moved on starts again at one.
create table core.reminder_state (
  user_id      uuid not null references core.users(id) on delete cascade,
  project_id   uuid not null references core.projects(id) on delete cascade,
  fingerprint  text not null,
  sent_count   integer not null default 0,
  last_sent_on date,
  primary key (user_id, project_id)
);
