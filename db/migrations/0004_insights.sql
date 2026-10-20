-- 0004_insights.sql
-- Team knowledge across every project in a workspace.
-- Dependency rule: insights references core and research.themes only.

create schema insights;

create type insights.match_method as enum ('auto', 'manual');

create table insights.platform_themes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  title        text not null,
  category     research.theme_category not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);

-- Which project themes roll up into a platform theme. A project theme belongs to at most one.
-- Phase 1: a simulated matcher fills this in; a manual tag overrides it.
create table insights.platform_theme_sources (
  platform_theme_id uuid not null references insights.platform_themes(id) on delete cascade,
  theme_id          uuid not null unique references research.themes(id) on delete cascade,
  workspace_id      uuid not null references core.workspaces(id) on delete cascade,
  match_method      insights.match_method not null default 'auto',
  confidence        numeric(3,2) check (confidence between 0 and 1),
  created_at        timestamptz not null default now(),
  primary key (platform_theme_id, theme_id)
);

create table insights.recommendations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  title        text not null,
  why          text,
  priority     core.priority_level not null default 'medium',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);

create table insights.recommendation_themes (
  recommendation_id uuid not null references insights.recommendations(id) on delete cascade,
  platform_theme_id uuid not null references insights.platform_themes(id) on delete cascade,
  workspace_id      uuid not null references core.workspaces(id) on delete cascade,
  primary key (recommendation_id, platform_theme_id)
);

create table insights.case_studies (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  title        text not null,
  summary      text,
  outcome      text,
  owner_team   text,
  occurred_on  date,
  color        text not null default '#faf3e6',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);

create table insights.case_study_themes (
  case_study_id     uuid not null references insights.case_studies(id) on delete cascade,
  platform_theme_id uuid not null references insights.platform_themes(id) on delete cascade,
  workspace_id      uuid not null references core.workspaces(id) on delete cascade,
  primary key (case_study_id, platform_theme_id)
);

do $$
declare t text;
begin
  foreach t in array array[
    'insights.platform_themes', 'insights.recommendations', 'insights.case_studies'
  ] loop
    execute format('create trigger touch before update on %s for each row execute function core.touch()', t);
  end loop;

  foreach t in array array[
    'insights.platform_themes', 'insights.platform_theme_sources', 'insights.recommendations',
    'insights.recommendation_themes', 'insights.case_studies', 'insights.case_study_themes'
  ] loop
    execute format('create index on %s (workspace_id)', t);
  end loop;
end $$;
