-- The Trash: what a person deletes is held for 90 days so it can be put back, then removed for good (the purge job, migration 0054's rules, does that).
-- A deleted project, document or journey is snapshotted whole (every row that hangs off it through cascading links) into `payload`, and then deleted
-- from the live tables exactly as before. Keeping it out of the live tables means nothing else in the app has to know about "deleted".
create table core.trash (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  kind         text not null check (kind in ('project', 'document', 'journey')),
  root_table   text not null,
  root_id      uuid not null,
  name         text not null,
  deleted_by   uuid references core.users(id) on delete set null,
  deleted_at   timestamptz not null default now(),
  purge_at     timestamptz not null,
  summary      jsonb not null default '{}'::jsonb,
  payload      jsonb not null,
  unique (root_table, root_id)
);
create index trash_workspace on core.trash (workspace_id, purge_at);
alter table core.trash enable row level security;
create policy workspace_isolation on core.trash using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
