-- Multi-tenancy, step 3: each workspace's own connections (Slack, Jira). Until now these were settings for the whole deployment, which a second
-- customer would have shared. A workspace with no row here has no connection; the deployment's own settings belong to its home workspace only.
-- The secret (a Slack bot token, a Jira API token) is stored encrypted by the app (AES-256-GCM, key in SETTINGS_ENCRYPTION_KEY), never in clear.
create table core.workspace_integrations (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  kind         text not null check (kind in ('slack', 'jira')),
  config       jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),  -- what is not secret: a Jira site, email and project key
  secret_enc   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),  -- set by whoever changes the row (there is no version column, so core.touch does not apply)
  updated_by   uuid references core.users(id) on delete set null,
  primary key (workspace_id, kind)
);
alter table core.workspace_integrations enable row level security;
create policy workspace_isolation on core.workspace_integrations using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
