-- 0036_teams.sql
-- Teams: a layer between the workspace and its projects. A team owns projects; a person has a role (owner, editor, viewer) in each team
-- they belong to. Workspace owners are the leaders: they can see every team.
-- Backward compatible with the previous code, which knows nothing of teams: a project inserted without a team lands in the workspace's default
-- team, and a person added to the workspace joins that team with the same role (triggers below), so the old code keeps working while it serves.

create table core.teams (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name         text not null,
  -- The team new members and new projects land in when no other is named. Exactly one per workspace.
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create unique index teams_name_key on core.teams (workspace_id, lower(name));
create unique index teams_one_default_key on core.teams (workspace_id) where is_default;

create table core.team_memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  team_id      uuid not null references core.teams(id) on delete cascade,
  user_id      uuid not null references core.users(id) on delete cascade,
  role         core.member_role not null default 'editor',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1,
  unique (team_id, user_id)
);
create index team_memberships_user_idx on core.team_memberships (user_id);
create index team_memberships_workspace_idx on core.team_memberships (workspace_id);

create trigger touch before update on core.teams for each row execute function core.touch();
create trigger touch before update on core.team_memberships for each row execute function core.touch();

-- A team's projects. Nullable while the previous code can still insert projects; the trigger below fills it.
alter table core.projects add column team_id uuid references core.teams(id) on delete restrict;
create index projects_team_idx on core.projects (team_id);

-- Everything that exists today goes into one default team, with each person's role as it is now. The touch trigger is off for the backfill so
-- no project's version moves (a page open during the deploy would otherwise meet a conflict on its next save).
insert into core.teams (workspace_id, name, is_default)
select w.id, 'General', true from core.workspaces w;

insert into core.team_memberships (workspace_id, team_id, user_id, role, created_by)
select m.workspace_id, t.id, m.user_id, m.role, m.created_by
from core.memberships m join core.teams t on t.workspace_id = m.workspace_id and t.is_default;

alter table core.projects disable trigger touch;
update core.projects p set team_id = t.id from core.teams t where t.workspace_id = p.workspace_id and t.is_default and p.team_id is null;
alter table core.projects enable trigger touch;

-- Keeping the default team in step while the workspace still has one way to add and change people.
create function core.workspace_default_team() returns trigger language plpgsql as $$
begin
  insert into core.teams (workspace_id, name, is_default) values (new.id, 'General', true);
  return null;
end $$;
create trigger workspaces_default_team after insert on core.workspaces for each row execute function core.workspace_default_team();

create function core.membership_default_team() returns trigger language plpgsql as $$
begin
  insert into core.team_memberships (workspace_id, team_id, user_id, role, created_by)
  select new.workspace_id, t.id, new.user_id, new.role, new.created_by
  from core.teams t where t.workspace_id = new.workspace_id and t.is_default
  on conflict (team_id, user_id) do nothing;
  return null;
end $$;
create trigger memberships_default_team after insert on core.memberships for each row execute function core.membership_default_team();

-- A role changed on the workspace membership carries to the default team only: roles in other teams are set on those teams.
create function core.membership_role_default_team() returns trigger language plpgsql as $$
begin
  update core.team_memberships tm set role = new.role
  from core.teams t
  where t.id = tm.team_id and t.workspace_id = new.workspace_id and t.is_default and tm.user_id = new.user_id;
  return null;
end $$;
create trigger memberships_role_default_team after update of role on core.memberships for each row when (old.role is distinct from new.role) execute function core.membership_role_default_team();

create function core.project_default_team() returns trigger language plpgsql as $$
begin
  if new.team_id is null then
    select t.id into new.team_id from core.teams t where t.workspace_id = new.workspace_id and t.is_default;
  end if;
  return new;
end $$;
create trigger projects_default_team before insert on core.projects for each row execute function core.project_default_team();
