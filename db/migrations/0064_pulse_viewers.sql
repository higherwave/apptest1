-- Pulse access: owners and editors see and change Pulse; other members (viewers: department leaders in sales, customer success, sales ops, product and design) can be
-- granted VIEW access one by one by an owner. A grant never lets anyone change anything. A new table the previous code ignores.
create table core.pulse_viewers (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  user_id      uuid not null references core.users(id) on delete cascade,
  granted_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table core.pulse_viewers enable row level security;
create policy workspace_isolation on core.pulse_viewers using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
