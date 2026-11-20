-- 0057_pulse.sql
-- Pulse, slice 1: customer signals gathered by hand or from a connected channel, for early problem framing. Two new tables the previous code ignores.
--   core.workspace_features  a preview switch per workspace (an owner turns a feature on; with no row it is off)
--   core.pulse_signals       one signal: a quote, request or complaint, with where it came from and what it is about
create table core.workspace_features (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  feature      text not null check (feature in ('pulse')),
  enabled      boolean not null default false,
  updated_by   uuid references core.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, feature)
);
alter table core.workspace_features enable row level security;
create policy workspace_isolation on core.workspace_features using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());

create table core.pulse_signals (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  body         text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  kind         text not null default 'other' check (kind in ('complaint', 'request', 'praise', 'question', 'other')),
  -- How it arrived: typed in, split out of pasted or uploaded notes, or read from a connected channel.
  source       text not null check (source in ('manual', 'notes', 'slack')),
  source_label text,
  source_url   text,
  said_by      text,
  account      text,
  occurred_on  date,
  -- New signals wait for a person to keep or dismiss them; only kept ones will count toward topics.
  status       text not null default 'new' check (status in ('new', 'kept', 'dismissed')),
  -- The channel's own id for a message, so reading the same message twice never makes two signals.
  external_id  text,
  created_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index pulse_signals_external_once on core.pulse_signals (workspace_id, source, external_id) where external_id is not null;
create index pulse_signals_workspace_idx on core.pulse_signals (workspace_id, status, created_at desc);
alter table core.pulse_signals enable row level security;
create policy workspace_isolation on core.pulse_signals using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
