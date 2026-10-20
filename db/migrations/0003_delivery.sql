-- 0003_delivery.sql
-- Requirements document and Stories board.
-- Dependency rule: delivery references core and research.themes only.

create schema delivery;

create type delivery.spec_status     as enum ('draft', 'published');
create type delivery.story_status    as enum ('todo', 'in_progress', 'in_review', 'done');
create type delivery.story_kind      as enum ('requirement', 'open_question');
create type delivery.checklist_kind  as enum ('criterion', 'task');

create table delivery.specs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id   uuid not null references core.projects(id) on delete cascade,
  name         text not null,
  agent_run_id uuid references core.agent_runs(id) on delete set null,
  status       delivery.spec_status not null default 'draft',
  published_at timestamptz,
  stale        boolean not null default false,   -- set when a newer analysis run replaces its themes
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create index specs_project_idx on delivery.specs (project_id);

-- Which themes the document uses (the include/exclude chips).
create table delivery.spec_themes (
  spec_id      uuid not null references delivery.specs(id) on delete cascade,
  theme_id     uuid not null references research.themes(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  included     boolean not null default true,
  primary key (spec_id, theme_id)
);

-- Theme chips shown as "Evidence" on a step.
create table delivery.spec_step_evidence (
  step_id      uuid not null references core.agent_steps(id) on delete cascade,
  theme_id     uuid not null references research.themes(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  primary key (step_id, theme_id)
);

-- Snapshot of each in-scope theme, taken at publish, so a published requirement does not
-- change if its theme is later re-analysed.
create table delivery.requirements (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references core.workspaces(id) on delete cascade,
  spec_id          uuid not null references delivery.specs(id) on delete cascade,
  theme_id         uuid references research.themes(id) on delete set null,
  title            text not null,
  category         research.theme_category,
  priority         core.priority_level not null default 'medium',
  effort           smallint check (effort between 1 and 3),
  opportunity      text,
  supporting_quote text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references core.users(id) on delete set null,
  updated_by       uuid references core.users(id) on delete set null,
  version          integer not null default 1
);
create index requirements_spec_idx on delivery.requirements (spec_id);

-- Board cards, including open questions. Theme label and participant count are read from the
-- theme, never stored.
create table delivery.stories (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  spec_id        uuid not null references delivery.specs(id) on delete cascade,
  requirement_id uuid references delivery.requirements(id) on delete set null,
  theme_id       uuid references research.themes(id) on delete set null,
  kind           delivery.story_kind not null default 'requirement',
  key            text not null,                  -- R1, R2, Q1 ...
  title          text not null,
  status         delivery.story_status not null default 'todo',
  position       numeric not null default 0,     -- fractional ordering within a status column
  priority       core.priority_level not null default 'medium',
  owner_team     text,
  summary        text,
  why_it_matters text,
  next_step      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1,
  unique (spec_id, key)
);
create index stories_board_idx on delivery.stories (spec_id, status, position);

create table delivery.story_checklist (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  story_id     uuid not null references delivery.stories(id) on delete cascade,
  kind         delivery.checklist_kind not null default 'criterion',
  text         text not null,
  met          boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create index story_checklist_story_idx on delivery.story_checklist (story_id, position);

-- Rule: a spec can be published only when it has steps and every step is approved.
create function delivery.require_approved_steps() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if new.agent_run_id is null
       or not exists (select 1 from core.agent_steps where run_id = new.agent_run_id)
       or exists (select 1 from core.agent_steps where run_id = new.agent_run_id and status <> 'approved')
    then
      raise exception 'spec % cannot be published until every step is approved', new.id
        using errcode = 'check_violation';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;

create trigger require_approved_steps before update on delivery.specs
  for each row execute function delivery.require_approved_steps();

-- Deleting a spec also deletes its agent run (and so its steps).
create function delivery.delete_spec_run() returns trigger language plpgsql as $$
begin
  if old.agent_run_id is not null then
    delete from core.agent_runs where id = old.agent_run_id;
  end if;
  return old;
end $$;

create trigger delete_spec_run after delete on delivery.specs
  for each row execute function delivery.delete_spec_run();

do $$
declare t text;
begin
  foreach t in array array[
    'delivery.specs', 'delivery.requirements', 'delivery.stories', 'delivery.story_checklist'
  ] loop
    execute format('create trigger touch before update on %s for each row execute function core.touch()', t);
  end loop;

  foreach t in array array[
    'delivery.specs', 'delivery.spec_themes', 'delivery.spec_step_evidence',
    'delivery.requirements', 'delivery.stories', 'delivery.story_checklist'
  ] loop
    execute format('create index on %s (workspace_id)', t);
  end loop;
end $$;
