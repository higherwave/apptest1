-- 0028_merge_history.sql
-- Every merge of one platform theme into another, by the system or by hand, is kept with enough to take it back: the theme that
-- was folded in (its title, category, other names, review state), which project themes moved, and which recommendation and case-study
-- links and other names it added to the theme it was folded into. Undo recreates the theme under its old id and moves exactly those back.
-- Backward compatible: a new table the previous code ignores.

create table insights.merge_history (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  kept_id      uuid not null references insights.platform_themes(id) on delete cascade,
  merged_id    uuid not null,
  merged       jsonb not null,
  moved        jsonb not null,
  confidence   numeric(3,2) check (confidence between 0 and 1),
  reason       text,
  auto         boolean not null default false,
  created_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  undone_at    timestamptz,
  undone_by    uuid references core.users(id) on delete set null
);
create index merge_history_workspace_idx on insights.merge_history (workspace_id, created_at desc);
