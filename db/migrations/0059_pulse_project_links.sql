-- 0059_pulse_project_links.sql
-- Pulse, slice 3: which topics a Signal Flow project was started from, so its Test Plan can say "From Pulse: 3 topics, 41 signals" and link back. A new table the previous code ignores.
-- The title and the count are kept as they were when the project was made, so a later merge or regrouping does not rewrite what the project started from.
create table core.pulse_project_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id   uuid not null references core.projects(id) on delete cascade,
  topic_id     uuid references core.pulse_topics(id) on delete set null,
  topic_title  text not null,
  signal_count integer not null check (signal_count >= 0),
  created_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index pulse_project_links_project_idx on core.pulse_project_links (project_id);
alter table core.pulse_project_links enable row level security;
create policy workspace_isolation on core.pulse_project_links using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
