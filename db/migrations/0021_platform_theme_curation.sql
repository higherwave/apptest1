-- 0021_platform_theme_curation.sql
-- Keeping Platform Themes clean over time: old names kept as aliases when a theme is renamed or merged (so the matcher still
-- recognises them), the model's one-line reason for each match, suggested merges waiting for a person's yes, and a written
-- rationale for where a theme ranks.
create table insights.platform_theme_aliases (
  platform_theme_id uuid not null references insights.platform_themes(id) on delete cascade,
  workspace_id      uuid not null references core.workspaces(id) on delete cascade,
  alias             text not null,
  created_at        timestamptz not null default now(),
  primary key (platform_theme_id, alias)
);
create index on insights.platform_theme_aliases (workspace_id);

alter table insights.platform_theme_sources add column reason text;
alter table insights.platform_themes add column rationale text, add column rationale_at timestamptz;

create table insights.merge_suggestions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  keep_id      uuid not null references insights.platform_themes(id) on delete cascade,
  merge_id     uuid not null references insights.platform_themes(id) on delete cascade,
  reason       text,
  confidence   numeric(3,2) check (confidence between 0 and 1),
  status       text not null default 'pending' check (status in ('pending', 'dismissed')),
  created_at   timestamptz not null default now(),
  check (keep_id <> merge_id),
  unique (keep_id, merge_id)
);
create index on insights.merge_suggestions (workspace_id);
