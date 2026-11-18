-- The starter team of a workspace is called Platform (it was General): it nudges an owner to use it for the people who normally have access to everything. A name is
-- not enforced, and an owner can rename it. New workspaces get Platform; an existing starter team still named General is renamed, unless the workspace already
-- has a team called Platform.
create or replace function core.workspace_default_team() returns trigger language plpgsql as $$
begin
  insert into core.teams (workspace_id, name, is_default) values (new.id, 'Platform', true);
  return null;
end $$;

update core.teams t set name = 'Platform'
 where t.is_default and t.name = 'General'
   and not exists (select 1 from core.teams o where o.workspace_id = t.workspace_id and lower(o.name) = 'platform');
