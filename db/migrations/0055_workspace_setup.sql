-- Workspace setup (onboarding for workspace owners): which of the guided categories are finished or skipped. What is done is read from the workspace itself
-- (teams, approvers, categories), so this only records that an owner marked a category done, or skipped an optional one.
create table core.workspace_setup (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  step         text not null check (step in ('people', 'approvals', 'categories', 'connections', 'guard')),
  status       text not null check (status in ('done', 'skipped')),
  updated_by   uuid references core.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, step)
);
alter table core.workspace_setup enable row level security;
create policy workspace_isolation on core.workspace_setup using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
