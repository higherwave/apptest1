-- 0011_test_items.sql
-- A test plan holds several test items, each with its own description and expected outcomes (it used to hold one
-- description and one outcomes list). Participants gain a phone number.
create table research.test_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id   uuid not null references core.projects(id) on delete cascade,
  position     integer not null default 0,
  description  text,
  outcomes     text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create index test_items_project_idx on research.test_items (project_id, position);
create index on research.test_items (workspace_id);
create trigger touch before update on research.test_items for each row execute function core.touch();

alter table research.participants add column phone text;

-- Each research project's single description and outcomes list become its first test item. The old columns stay on
-- research.studies (stand-alone requirements documents still use them) but are emptied for research projects, so
-- the items are the only copy.
insert into research.test_items (workspace_id, project_id, position, description, outcomes, created_by, updated_by)
select s.workspace_id, s.project_id, 0, s.what_testing, s.outcomes, s.created_by, s.updated_by
from research.studies s join core.projects p on p.id = s.project_id
where p.kind = 'research' and (coalesce(s.what_testing, '') <> '' or cardinality(s.outcomes) > 0);

update research.studies s set what_testing = null, outcomes = '{}'
from core.projects p where p.id = s.project_id and p.kind = 'research';
