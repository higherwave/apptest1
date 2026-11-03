-- 0029_area_proposal_dismissals.sql
-- A suggested new feature area (a group of themes with no area that share a word) that a person said "not now" to. The key is the
-- group's stem, so the same suggestion is not offered again. Backward compatible: a new table the previous code ignores.

create table insights.area_proposal_dismissals (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  key          text not null,
  dismissed_by uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, key)
);
