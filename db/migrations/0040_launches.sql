-- 0040_launches.sql
-- Launch, slice 3: the go signals for a project's release. One launch per project (unique project_id; relax later if a project ever needs several).
--   delivery.launches         the launch: name, target date, the owner's brief notes (and when they last changed).
--   delivery.launch_answers   append-only: each answer a step's reviewer gives (ready, ready with conditions, changes needed, not applicable; or go,
--                             go with conditions, no-go for the final decision), with its rationale and the brief it was given on (brief_key). The
--                             latest per step is the current one; one whose brief_key is no longer the brief's is "reopened", and stays on record.
--   delivery.launch_links     the documents a step's reviewer points to as evidence.
-- Backward compatible: three new tables the previous code ignores.

create table delivery.launches (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references core.workspaces(id) on delete cascade,
  project_id       uuid not null unique references core.projects(id) on delete cascade,
  name             text not null,
  target_date      date,
  brief_notes      text not null default '',
  notes_updated_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references core.users(id) on delete set null,
  updated_by       uuid references core.users(id) on delete set null,
  version          integer not null default 1
);
create trigger touch before update on delivery.launches for each row execute function core.touch();

create table delivery.launch_answers (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references delivery.launches(id) on delete cascade,
  step        text not null check (step in ('product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision')),
  answer      text not null check (answer in ('ready', 'ready_with_conditions', 'changes_needed', 'not_applicable', 'go', 'go_with_conditions', 'no_go')),
  rationale   text not null default '',
  -- What the brief was when this was answered: the published requirements document and the brief notes. A different brief reopens the answer.
  brief_key   text not null,
  -- For the final decision: the steps that were not ready at the time, with their answers, so going with open items is on the record.
  open_items  jsonb,
  answered_by uuid references core.users(id) on delete set null,
  answered_at timestamptz not null default now()
);
create index launch_answers_latest_idx on delivery.launch_answers (launch_id, step, answered_at desc);

create table delivery.launch_links (
  id        uuid primary key default gen_random_uuid(),
  launch_id uuid not null references delivery.launches(id) on delete cascade,
  step      text not null check (step in ('product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision')),
  title     text not null,
  url       text not null,
  added_by  uuid references core.users(id) on delete set null,
  added_at  timestamptz not null default now()
);
create index launch_links_launch_idx on delivery.launch_links (launch_id, step);
