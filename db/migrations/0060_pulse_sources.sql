-- Pulse slice 4: the places Pulse is allowed to read customer feedback from. Only a source listed here is ever read (never a whole Slack workspace).
--   core.pulse_sources   one designated source: today a Slack channel; docs and Salesforce fields come later as other kinds
-- Backward compatible: a new table only.
create table core.pulse_sources (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references core.workspaces(id) on delete cascade,
  kind            text not null default 'slack' check (kind in ('slack')),
  -- The channel as typed (no "#"), and Slack's own id once it has been found.
  name            text not null check (name ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  ref             text,
  -- Which weighted channel its messages count as (a Slack channel for support questions can count as support tickets).
  channel         text not null default 'slack' check (channel in ('slack', 'call_notes', 'support_tickets', 'conference', 'other')),
  -- keep: messages count at once. review: they wait for a person to keep or dismiss them.
  mode            text not null default 'review' check (mode in ('keep', 'review')),
  enabled         boolean not null default true,
  -- Slack's timestamp of the newest message read, so the next check starts after it.
  cursor_ts       text,
  last_checked_at timestamptz,
  last_added      int,
  last_error      text,
  created_by      uuid references core.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (workspace_id, kind, name)
);
alter table core.pulse_sources enable row level security;
create policy workspace_isolation on core.pulse_sources using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
