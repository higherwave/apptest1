-- 0017_success_measures.sql
-- The Measure step: for each requirement story, how we will know it worked (the metric, where it comes from, the baseline and the
-- target) and the check-ins made over time (date, value, verdict, note). One row per story, made when something is first saved.
-- The check-ins are a small list kept in the row and saved with it, so a row always reads and changes as one piece.
create table delivery.success_measures (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  story_id       uuid not null unique references delivery.stories(id) on delete cascade,
  metric         text,
  source         text check (source in ('telemetry', 'kpi', 'research', 'other')),
  baseline       text,
  target         text,
  checkins       jsonb not null default '[]'::jsonb check (jsonb_typeof(checkins) = 'array'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1
);

create trigger touch before update on delivery.success_measures for each row execute function core.touch();
