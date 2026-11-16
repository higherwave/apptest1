-- Multi-tenancy, step 2: the database itself refuses to show or change another workspace's rows.
--
-- The app runs each query as the role sf_app (set per query, inside its own transaction) with app.workspace_id set to the workspace the
-- request belongs to. Every table with a workspace_id then answers only for that workspace, and a write naming another workspace is
-- refused. A query with no workspace set sees nothing. The role that owns the tables (migrations, sign-in, the scheduler) is not
-- restricted: those are the platform's own paths and are listed in the code. This is the second lock behind the API's checks.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sf_app') then create role sf_app nologin; end if;
end $$;
-- Lets the connecting role switch to it (needed before PostgreSQL 16; harmless after).
do $$ begin execute format('grant sf_app to %I', current_user); exception when others then null; end $$;

create function core.current_workspace() returns uuid language sql stable as
$$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

grant usage on schema core, research, delivery, insights to sf_app;
grant select, insert, update, delete on all tables in schema core, research, delivery, insights to sf_app;
grant usage, select on all sequences in schema core, research, delivery, insights to sf_app;
alter default privileges in schema core, research, delivery, insights grant select, insert, update, delete on tables to sf_app;
alter default privileges in schema core, research, delivery, insights grant usage, select on sequences to sf_app;
-- The few things in the public schema the app reads or clears itself. Nothing else of sign-in is reachable from sf_app.
grant usage on schema public to sf_app;
do $$ begin if to_regclass('public.schema_migrations') is not null then grant select on public.schema_migrations to sf_app; end if; end $$;
grant select (user_id), delete on public.auth_session to sf_app;

-- Every table that carries a workspace id.
do $$
declare t record;
begin
  for t in
    select c.table_schema s, c.table_name n from information_schema.columns c
      join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
     where c.column_name = 'workspace_id' and c.table_schema in ('core', 'research', 'delivery', 'insights')
  loop
    execute format('alter table %I.%I enable row level security', t.s, t.n);
    execute format('create policy workspace_isolation on %I.%I using (workspace_id = core.current_workspace()) with check (workspace_id = core.current_workspace())', t.s, t.n);
  end loop;
end $$;

-- A workspace sees only itself.
alter table core.workspaces enable row level security;
create policy workspace_isolation on core.workspaces using (id = core.current_workspace()) with check (id = core.current_workspace());

-- People are global (one person can belong to several workspaces), so a workspace sees only the people who are members of it.
-- Creating or finding a person by email goes through the function below, which hands back an id and nothing else.
alter table core.users enable row level security;
create policy members_only on core.users for select using (exists (select 1 from core.memberships m where m.user_id = core.users.id and m.workspace_id = core.current_workspace()));
create policy members_only_update on core.users for update using (exists (select 1 from core.memberships m where m.user_id = core.users.id and m.workspace_id = core.current_workspace()));

create function core.user_id_for_email(p_email text, p_name text, p_avatar text default null) returns uuid language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  select id into uid from core.users where lower(email) = lower(p_email);
  if uid is null then
    insert into core.users (email, display_name, avatar_url) values (lower(p_email), p_name, p_avatar) returning id into uid;
  end if;
  return uid;
end $$;
revoke all on function core.user_id_for_email(text, text, text) from public;
grant execute on function core.user_id_for_email(text, text, text) to sf_app;
