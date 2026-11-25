-- 0069_pulse_dismissals.sql
-- Why a topic was dismissed, kept as a record per dismissal (not on the topic, which forgets it when the topic comes back). Each says which topic by name, the reason picked, an optional comment, how many signals
-- it had and which, and who did it, so topic matching can learn from the choices over time.
create table core.pulse_dismissals (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references core.workspaces(id) on delete cascade,
  topic_id      uuid references core.pulse_topics(id) on delete set null,
  topic_title   text not null,
  reason        text not null check (reason in ('addressed', 'not_relevant', 'duplicate', 'other')),
  comment       text check (comment is null or length(comment) <= 500),
  signal_count  integer not null default 0,
  signal_ids    uuid[] not null default '{}',
  created_by    uuid references core.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index pulse_dismissals_workspace_idx on core.pulse_dismissals (workspace_id, created_at desc);
alter table core.pulse_dismissals enable row level security;
create policy workspace_isolation on core.pulse_dismissals using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
