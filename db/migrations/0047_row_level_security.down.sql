drop function core.user_id_for_email(text, text, text);
drop policy members_only_update on core.users;
drop policy members_only on core.users;
alter table core.users disable row level security;
drop policy workspace_isolation on core.workspaces;
alter table core.workspaces disable row level security;
do $$
declare t record;
begin
  for t in select schemaname s, tablename n from pg_policies where policyname = 'workspace_isolation' loop
    execute format('drop policy workspace_isolation on %I.%I', t.s, t.n);
    execute format('alter table %I.%I disable row level security', t.s, t.n);
  end loop;
end $$;
drop function core.current_workspace();
