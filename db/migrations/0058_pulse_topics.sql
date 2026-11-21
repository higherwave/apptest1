-- 0058_pulse_topics.sql
-- Pulse, slice 2: a channel on every signal, topics (kept signals grouped), the weight each channel counts for, and when topics were last updated.
-- Backward compatible: a new column with a default, and new tables the previous code ignores.
alter table core.pulse_signals add column channel text not null default 'other' check (channel in ('slack', 'call_notes', 'support_tickets', 'conference', 'other'));
-- When a signal was last kept, so "added since topics were last updated" is honest about signals kept later than they were created.
alter table core.pulse_signals add column kept_at timestamptz;
update core.pulse_signals set kept_at = created_at where status = 'kept';
update core.pulse_signals set channel = case source when 'slack' then 'slack' when 'notes' then 'call_notes' else 'other' end;

create table core.pulse_topics (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  -- A person who renames, merges or splits a topic takes it over: the nightly regrouping leaves it alone.
  edited       boolean not null default false,
  status       text not null default 'active' check (status in ('active', 'merged')),
  merged_into  uuid references core.pulse_topics(id) on delete set null,
  created_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index pulse_topics_workspace_idx on core.pulse_topics (workspace_id, status);
alter table core.pulse_topics enable row level security;
create policy workspace_isolation on core.pulse_topics using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());

-- A signal is in at most one topic.
create table core.pulse_topic_signals (
  signal_id    uuid primary key references core.pulse_signals(id) on delete cascade,
  topic_id     uuid not null references core.pulse_topics(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade
);
create index pulse_topic_signals_topic_idx on core.pulse_topic_signals (topic_id);
alter table core.pulse_topic_signals enable row level security;
create policy workspace_isolation on core.pulse_topic_signals using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());

-- What a signal from each channel counts for in a topic's ranking. No row: the default for that channel (server/pulse-topics.ts).
create table core.pulse_weights (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  channel      text not null check (channel in ('slack', 'call_notes', 'support_tickets', 'conference', 'other')),
  weight       numeric(4, 2) not null check (weight >= 0 and weight <= 5),
  updated_by   uuid references core.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, channel)
);
alter table core.pulse_weights enable row level security;
create policy workspace_isolation on core.pulse_weights using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());

-- When topics were last updated and how (attach = new signals only; regroup = everything not edited by a person).
create table core.pulse_state (
  workspace_id    uuid primary key references core.workspaces(id) on delete cascade,
  updated_at      timestamptz not null default now(),
  last_regroup_at timestamptz,
  updated_by      uuid references core.users(id) on delete set null
);
alter table core.pulse_state enable row level security;
create policy workspace_isolation on core.pulse_state using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
