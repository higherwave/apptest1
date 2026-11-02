-- 0024_feature_areas.sql
-- Feature areas: one shared list per workspace of what research is about (Scheduling, Reminders, Account setup). A question to ask or
-- task to observe, and a test item, can name its area, so that what participants say is described in the same words across studies and
-- duplicate themes are caught upstream. An area is a label, never a gate: nothing requires one. Retired areas keep their history;
-- a merged area records where it went and its name stays on the target as an alias.
-- Backward compatible: new table, new nullable columns; the previous code ignores them.

create table insights.feature_areas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name         text not null,
  definition   text,
  aliases      text[] not null default '{}',
  retired_at   timestamptz,
  merged_into  uuid references insights.feature_areas(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create unique index feature_areas_name_key on insights.feature_areas (workspace_id, lower(name)) where retired_at is null;
create index feature_areas_workspace_idx on insights.feature_areas (workspace_id);
create trigger touch before update on insights.feature_areas for each row execute function core.touch();

alter table research.tasks      add column area_id uuid references insights.feature_areas(id) on delete set null;
alter table research.test_items add column area_id uuid references insights.feature_areas(id) on delete set null;
create index tasks_area_idx      on research.tasks (area_id)      where area_id is not null;
create index test_items_area_idx on research.test_items (area_id) where area_id is not null;
