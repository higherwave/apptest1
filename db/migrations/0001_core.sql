-- 0001_core.sql
-- Identity, project root, shared agent-run pattern, audit log.
-- Dependency rule: core references no other schema.

create schema core;

create type core.member_role    as enum ('owner', 'editor', 'viewer');
create type core.project_kind   as enum ('research', 'standalone');
create type core.template_kind  as enum ('study');
create type core.priority_level as enum ('low', 'medium', 'high');
create type core.run_kind       as enum ('analysis', 'spec');
create type core.run_status     as enum ('running', 'complete', 'failed');
create type core.step_status    as enum ('pending', 'thinking', 'review', 'approved');

-- Bumps updated_at and version on every update (optimistic locking is enforced in the API
-- with WHERE version = :expected).
create function core.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version    := old.version + 1;
  return new;
end $$;

-- Tenancy and accounts ---------------------------------------------------------------------

create table core.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table core.users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  display_name text not null,
  avatar_url   text,
  auth_subject text unique,            -- filled by the auth provider later
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);
create unique index users_email_lower_key on core.users (lower(email));

create table core.memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  user_id      uuid not null references core.users(id) on delete cascade,
  role         core.member_role not null default 'editor',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1,
  unique (workspace_id, user_id)
);

-- Templates ----------------------------------------------------------------------------------

create table core.templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  kind         core.template_kind not null default 'study',
  key          text not null,           -- usability, discovery, concept, blank
  name         text not null,
  description text,
  body         jsonb not null default '{}'::jsonb,  -- what, outcomes, methods, tasks with follow-ups
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1,
  unique (workspace_id, kind, key)
);

-- The root of everything ---------------------------------------------------------------------

create table core.projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name         text not null,
  color        text not null default '#faf3e6',
  kind         core.project_kind not null default 'research',
  template_id  uuid references core.templates(id) on delete set null,
  owner_id     uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create index projects_workspace_kind_idx on core.projects (workspace_id, kind);

-- Shared agent-run pattern (phase 1 simulated, phase 2 real) -----------------------------------

create table core.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  project_id     uuid not null references core.projects(id) on delete cascade,
  kind           core.run_kind not null,
  status         core.run_status not null default 'running',
  input_hash     text,                  -- hash of the transcripts (analysis) at the time of the run
  superseded_at  timestamptz,           -- set when a newer analysis run completes
  provider       text not null default 'stub',
  model          text,
  prompt_version text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1
);
create index agent_runs_project_kind_idx on core.agent_runs (project_id, kind, started_at desc);

create table core.agent_steps (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  run_id       uuid not null references core.agent_runs(id) on delete cascade,
  position     integer not null,
  key          text not null,
  title        text not null,
  reasoning    text,
  edited_text  text,
  status       core.step_status not null default 'pending',
  redo_note    text,
  revision     integer not null default 0,
  output       jsonb,                   -- e.g. { "heading": "Problem", "lines": [...] }
  approved_by  uuid references core.users(id) on delete set null,
  approved_at  timestamptz,
  locked_by    uuid references core.users(id) on delete set null,
  locked_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1,
  unique (run_id, position)
);

create table core.agent_step_alternatives (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  step_id      uuid not null references core.agent_steps(id) on delete cascade,
  position     integer not null default 0,
  title        text not null,
  reason       text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);

-- Append-only history; powers Undo. No foreign keys on entity so it survives hard deletes.
create table core.audit_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  actor_id     uuid references core.users(id) on delete set null,
  entity       text not null,           -- e.g. 'delivery.stories'
  entity_id    uuid,
  verb         text not null,           -- created, moved, approved, deleted, ...
  before       jsonb,
  after        jsonb,
  undone_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index audit_log_entity_idx on core.audit_log (workspace_id, entity, entity_id, created_at desc);

-- Triggers and tenancy indexes ----------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'core.workspaces', 'core.users', 'core.memberships', 'core.templates', 'core.projects',
    'core.agent_runs', 'core.agent_steps', 'core.agent_step_alternatives'
  ] loop
    execute format('create trigger touch before update on %s for each row execute function core.touch()', t);
  end loop;

  foreach t in array array[
    'core.memberships', 'core.templates', 'core.projects', 'core.agent_runs', 'core.agent_steps',
    'core.agent_step_alternatives', 'core.audit_log'
  ] loop
    execute format('create index on %s (workspace_id)', t);
  end loop;
end $$;
