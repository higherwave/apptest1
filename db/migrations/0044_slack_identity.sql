-- 0044_slack_identity.sql
-- Launch, slice 7: acting from Slack. A person links their Slack user to their Signal Flow member once, with a one-time code, so a button click in Slack is
-- known to be them; and every request Slack signs is remembered so a replay is refused.
--   core.slack_links          a member and the Slack user (in one Slack workspace) they are. One each way.
--   core.slack_connect_codes  a one-time code (stored hashed) a member asks for in Signal Flow and enters in Slack as /signalflow connect <code>.
--   core.slack_requests       the signature of every Slack request that was acted on, so the same request cannot be replayed.
-- Backward compatible: new tables the previous code ignores.

create table core.slack_links (
  user_id       uuid primary key references core.users(id) on delete cascade,
  workspace_id  uuid not null references core.workspaces(id) on delete cascade,
  slack_team_id text not null,
  slack_user_id text not null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, slack_team_id, slack_user_id)
);

create table core.slack_connect_codes (
  code_hash  text primary key,
  user_id    uuid not null references core.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table core.slack_requests (
  signature text primary key,
  seen_at   timestamptz not null default now()
);
create index slack_requests_seen_idx on core.slack_requests (seen_at);
