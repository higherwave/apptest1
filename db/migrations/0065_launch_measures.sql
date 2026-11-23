-- 0065_launch_measures.sql
-- Launch to Measure, slice 1: how a release will be judged is set on the LAUNCH, as a short list of rolled-up measures (adoption, engagement, time-to-value, ...)
-- rather than one per requirement. Each is the same one-sentence measure as before; the requirements it covers are an optional note. They can be changed until the
-- final decision is "go"; the launch keeps a version for the list so two people saving at once is a conflict, not a silent overwrite.
-- Backward compatible: a new table and a new column the previous code ignores. The per-requirement delivery.success_measures stays until the readers move over.
create table delivery.launch_measures (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references core.workspaces(id) on delete cascade,
  launch_id        uuid not null references delivery.launches(id) on delete cascade,
  position         integer not null,
  metric_kind      text not null check (metric_kind in ('tickets', 'adoption', 'engagement', 'time_to_value', 'retention', 'feedback', 'other')),
  detail           text,
  comparison       text not null default 'reach' check (comparison in ('change', 'below', 'above', 'between', 'reach')),
  value_a          text,
  value_b          text,
  unit             text,
  requirement_keys text[] not null default '{}',
  -- The readings after launch, oldest first: { on, value, verdict, note }. The newest is the result.
  checkins         jsonb not null default '[]'::jsonb check (jsonb_typeof(checkins) = 'array'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references core.users(id) on delete set null,
  updated_by       uuid references core.users(id) on delete set null,
  version          integer not null default 1
);
create index launch_measures_launch on delivery.launch_measures (launch_id, position);
create index launch_measures_workspace on delivery.launch_measures (workspace_id);
create trigger touch before update on delivery.launch_measures for each row execute function core.touch();
alter table delivery.launches add column measures_version integer not null default 0;
alter table delivery.launch_measures enable row level security;
create policy workspace_isolation on delivery.launch_measures using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace());
