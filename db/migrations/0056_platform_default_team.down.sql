create or replace function core.workspace_default_team() returns trigger language plpgsql as $$
begin
  insert into core.teams (workspace_id, name, is_default) values (new.id, 'General', true);
  return null;
end $$;

update core.teams t set name = 'General'
 where t.is_default and t.name = 'Platform'
   and not exists (select 1 from core.teams o where o.workspace_id = t.workspace_id and lower(o.name) = 'general');
