-- Legal holds, and what the 12-month cleanup needs. A hold stops the cleanup and every permanent deletion for what it covers (the whole workspace, or one project)
-- until an owner releases it. A hold has no end date: it lasts as long as the matter it serves. The hold's own record is never deleted.
create table core.legal_holds (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id   uuid,  -- null = the whole workspace. No foreign key on purpose: the hold must outlive the project, even in the Trash
  scope_name   text not null,
  reason       text not null check (length(btrim(reason)) between 3 and 1000),
  set_by       uuid references core.users(id) on delete set null,
  set_at       timestamptz not null default now(),
  released_by  uuid references core.users(id) on delete set null,
  released_at  timestamptz
);
create index legal_holds_active on core.legal_holds (workspace_id) where released_at is null;
create unique index legal_holds_one_active_per_scope on core.legal_holds (workspace_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) where released_at is null;
alter table core.legal_holds enable row level security;
create policy workspace_isolation on core.legal_holds using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());

-- The cleanup looks for old rows by date.
create index audit_log_age on core.audit_log (created_at);
