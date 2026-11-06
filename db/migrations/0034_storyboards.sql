-- 0034_storyboards.sql
-- Storyboard: the project's research told as a short deck for product leaders. The figures, quotes and themes on it are read live from the
-- project; only the parts a model writes (the headline, the problem, up to three recommended solutions with their trade-offs, and the
-- recommendation and ask) are kept here, so everyone sees and downloads the same text until an owner or editor generates it again.
-- One per project. Read-only in the app: nobody edits the text. Backward compatible: a new table the previous code ignores.

create table research.storyboards (
  project_id     uuid primary key references core.projects(id) on delete cascade,
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  draft          jsonb not null,
  prompt_version text not null,
  source         text not null check (source in ('model', 'template')),  -- 'template' is the free plain draft used when no model was available
  generated_at   timestamptz not null default now(),
  generated_by   uuid references core.users(id) on delete set null
);
