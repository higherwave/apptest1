-- 0039_launch_reviewers.sql
-- Launch, slice 1: who approves which step of a launch, set up once instead of per launch.
--   core.memberships.is_external     a member added from outside the company (outside counsel, a partner); their access is limited in the API.
--   core.reviewer_assignments        a standing assignment: a person, one step, all teams or one team, primary or alternate.
--   core.team_launch_steps           which steps a team's launches use (a row only where the team turned a step off or back on; no row means used).
-- Backward compatible: a new column with a default and two new tables the previous code ignores.

alter table core.memberships add column is_external boolean not null default false;

create table core.reviewer_assignments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  user_id      uuid not null references core.users(id) on delete cascade,
  step         text not null check (step in ('product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision')),
  -- null team_id means every team, including teams made later.
  team_id      uuid references core.teams(id) on delete cascade,
  role         text not null default 'primary' check (role in ('primary', 'alternate')),
  created_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null
);
-- One assignment per person, step and team (or all teams): nulls count as one value.
create unique index reviewer_assignments_once on core.reviewer_assignments (user_id, step, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index reviewer_assignments_workspace_idx on core.reviewer_assignments (workspace_id, step);

create table core.team_launch_steps (
  team_id uuid not null references core.teams(id) on delete cascade,
  step    text not null check (step in ('product_leadership', 'sales', 'legal', 'documentation', 'marketing')),  -- the final decision always applies
  used    boolean not null,
  primary key (team_id, step)
);
