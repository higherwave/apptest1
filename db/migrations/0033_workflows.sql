-- 0033_workflows.sql
-- Workflows: the workspace's service blueprint. A workflow (a flow of one app or feature, such as "Patient access") has ordered stages, and each
-- stage says what good looks like, the signal to watch and the handoff out of it, with the backstage under it: the teams, systems and
-- processes that work behind the stage, and who owns them. Edited once, in Platform Insights, and read by every project that is on the workflow.
-- A project is on at most one workflow (project_workflows, kept apart from core.projects so choosing one does not bump the project's version and
-- cause a false "someone else saved" on its test plan). Each of the project's journey stages can be mapped to a workflow stage.
-- Backward compatible: new tables and one nullable column the previous code ignores.

create table insights.workflows (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create unique index workflows_name_key on insights.workflows (workspace_id, lower(name));
create trigger touch before update on insights.workflows for each row execute function core.touch();

create table insights.workflow_stages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  workflow_id  uuid not null references insights.workflows(id) on delete cascade,
  position     smallint not null check (position >= 0),
  name         text not null,
  good         text,                      -- what "good" looks like
  signal       text,                      -- the signal to watch
  handoff      text,                      -- the handoff out of the stage
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);
create index workflow_stages_workflow_idx on insights.workflow_stages (workflow_id, position);
create trigger touch before update on insights.workflow_stages for each row execute function core.touch();

create table insights.workflow_backstage (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  stage_id     uuid not null references insights.workflow_stages(id) on delete cascade,
  position     smallint not null check (position >= 0),
  kind         text not null check (kind in ('Team', 'System', 'Process')),
  name         text not null,
  owner        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);
create index workflow_backstage_stage_idx on insights.workflow_backstage (stage_id, position);
create trigger touch before update on insights.workflow_backstage for each row execute function core.touch();

create table insights.project_workflows (
  project_id   uuid primary key references core.projects(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  workflow_id  uuid not null references insights.workflows(id) on delete cascade,
  updated_by   uuid references core.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index project_workflows_workflow_idx on insights.project_workflows (workflow_id);

alter table research.study_stages add column workflow_stage_id uuid references insights.workflow_stages(id) on delete set null;
create index study_stages_workflow_stage_idx on research.study_stages (workflow_stage_id) where workflow_stage_id is not null;
