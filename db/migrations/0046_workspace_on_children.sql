-- Multi-tenancy, step 1: every table that holds workspace data carries its own workspace id.
-- Seven child tables only had it through their parent (a launch, a team or a project). Each now stores it, filled from the parent, so a
-- query, an index or a row-level security rule can say "this workspace" without a join.
--
-- The previous code still inserts without the column while it serves. A trigger fills it from the parent on every insert (and always
-- overrides what was given, so a row can never disagree with its parent), which also lets the column be NOT NULL right away.

create function core.fill_workspace_id() returns trigger language plpgsql as $$
declare ws uuid;
begin
  -- TG_ARGV[0] = the parent table, TG_ARGV[1] = the column on this row that points at the parent's id.
  execute format('select workspace_id from %s where id = $1', TG_ARGV[0]) into ws using (to_jsonb(new) ->> TG_ARGV[1])::uuid;
  new.workspace_id := ws;
  return new;
end $$;

alter table delivery.launch_answers     add column workspace_id uuid references core.workspaces(id) on delete cascade;
alter table delivery.launch_links       add column workspace_id uuid references core.workspaces(id) on delete cascade;
alter table delivery.launch_digests     add column workspace_id uuid references core.workspaces(id) on delete cascade;
alter table delivery.launch_followers   add column workspace_id uuid references core.workspaces(id) on delete cascade;
alter table delivery.launch_slack_posts add column workspace_id uuid references core.workspaces(id) on delete cascade;
alter table core.team_launch_steps      add column workspace_id uuid references core.workspaces(id) on delete cascade;
alter table core.reminder_state         add column workspace_id uuid references core.workspaces(id) on delete cascade;

update delivery.launch_answers     c set workspace_id = p.workspace_id from delivery.launches p where p.id = c.launch_id;
update delivery.launch_links       c set workspace_id = p.workspace_id from delivery.launches p where p.id = c.launch_id;
update delivery.launch_digests     c set workspace_id = p.workspace_id from delivery.launches p where p.id = c.launch_id;
update delivery.launch_followers   c set workspace_id = p.workspace_id from delivery.launches p where p.id = c.launch_id;
update delivery.launch_slack_posts c set workspace_id = p.workspace_id from delivery.launches p where p.id = c.launch_id;
update core.team_launch_steps      c set workspace_id = p.workspace_id from core.teams p where p.id = c.team_id;
update core.reminder_state         c set workspace_id = p.workspace_id from core.projects p where p.id = c.project_id;

alter table delivery.launch_answers     alter column workspace_id set not null;
alter table delivery.launch_links       alter column workspace_id set not null;
alter table delivery.launch_digests     alter column workspace_id set not null;
alter table delivery.launch_followers   alter column workspace_id set not null;
alter table delivery.launch_slack_posts alter column workspace_id set not null;
alter table core.team_launch_steps      alter column workspace_id set not null;
alter table core.reminder_state         alter column workspace_id set not null;

create trigger fill_workspace before insert on delivery.launch_answers     for each row execute function core.fill_workspace_id('delivery.launches', 'launch_id');
create trigger fill_workspace before insert on delivery.launch_links       for each row execute function core.fill_workspace_id('delivery.launches', 'launch_id');
create trigger fill_workspace before insert on delivery.launch_digests     for each row execute function core.fill_workspace_id('delivery.launches', 'launch_id');
create trigger fill_workspace before insert on delivery.launch_followers   for each row execute function core.fill_workspace_id('delivery.launches', 'launch_id');
create trigger fill_workspace before insert on delivery.launch_slack_posts for each row execute function core.fill_workspace_id('delivery.launches', 'launch_id');
create trigger fill_workspace before insert on core.team_launch_steps      for each row execute function core.fill_workspace_id('core.teams', 'team_id');
create trigger fill_workspace before insert on core.reminder_state         for each row execute function core.fill_workspace_id('core.projects', 'project_id');

create index launch_answers_workspace     on delivery.launch_answers (workspace_id);
create index launch_links_workspace       on delivery.launch_links (workspace_id);
create index launch_digests_workspace     on delivery.launch_digests (workspace_id);
create index launch_followers_workspace   on delivery.launch_followers (workspace_id);
create index launch_slack_posts_workspace on delivery.launch_slack_posts (workspace_id);
create index team_launch_steps_workspace  on core.team_launch_steps (workspace_id);
create index reminder_state_workspace     on core.reminder_state (workspace_id);
