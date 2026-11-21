-- Pulse slice 5: customer accounts and their annual recurring revenue, copied (read-only) from Salesforce so topics can show the ARR behind them.
-- Only the account's id, name and ARR are kept. Nothing is ever written back to Salesforce. Backward compatible: two new tables.
create table core.pulse_accounts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  sf_id        text not null,
  name         text not null,
  -- The name as Pulse matches it to a signal's account: lower case, no punctuation, no "Inc" or "LLC".
  name_key     text not null,
  arr          numeric(16, 2) not null check (arr >= 0),
  synced_at    timestamptz not null default now(),
  unique (workspace_id, name_key)
);
alter table core.pulse_accounts enable row level security;
create policy workspace_isolation on core.pulse_accounts using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());


-- When the accounts were last copied, and why the last try failed (the old copy stays when one does).
create table core.pulse_account_sync (
  workspace_id uuid primary key references core.workspaces(id) on delete cascade,
  synced_at    timestamptz,
  error        text,
  tried_at     timestamptz not null default now()
);
alter table core.pulse_account_sync enable row level security;
create policy workspace_isolation on core.pulse_account_sync using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());

-- A workspace can connect Salesforce (read only) beside Slack and Jira. Widening a check: the previous code never writes a salesforce row, so it is unaffected.
alter table core.workspace_integrations drop constraint workspace_integrations_kind_check;
alter table core.workspace_integrations add constraint workspace_integrations_kind_check check (kind in ('slack', 'jira', 'salesforce'));
