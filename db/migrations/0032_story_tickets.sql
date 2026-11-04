-- 0032_story_tickets.sql
-- The Jira hand-off. When a story is turned into a ticket, what was sent (and by whom, and when) is kept here: the Sent to Jira
-- list and the record. The connection is simulated for now (simulated = true): the key is made here, not by Jira. A story keeps its
-- ticket even if a later board update removes the story (story_id becomes null; story_key stays). Backward compatible: a new table
-- the previous code ignores.

create table delivery.story_tickets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  spec_id      uuid not null references delivery.specs(id) on delete cascade,
  story_id     uuid references delivery.stories(id) on delete set null,
  story_key    text not null,                 -- R1, R2 ... at the time it was sent
  jira_key     text not null,                 -- PLAT-215
  project      text not null,                 -- 'PLAT · Platform'
  issue_type   text not null,
  summary      text not null,
  description  text not null default '',
  priority     text not null,
  assignee     text not null default 'Unassigned',
  labels       text not null default '',
  points       text,
  simulated    boolean not null default true,
  created_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, jira_key)
);
-- One ticket per story while the story exists.
create unique index story_tickets_story_idx on delivery.story_tickets (story_id) where story_id is not null;
create index story_tickets_spec_idx on delivery.story_tickets (spec_id, created_at desc);
