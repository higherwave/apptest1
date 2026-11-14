-- 0043_launch_follow.sql
-- Launch, slice 6: people who follow a launch from the research stage, and the digests shared with them.
--   delivery.launch_followers   a person following a launch (one launch per project). Following gives the digest and brief only, never access to the research.
--   delivery.launch_digests     one row per digest shared: who, when, how it went out, and the text as it was sent.
-- Backward compatible: two new tables the previous code ignores.

create table delivery.launch_followers (
  launch_id uuid not null references delivery.launches(id) on delete cascade,
  user_id   uuid not null references core.users(id) on delete cascade,
  added_by  uuid references core.users(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (launch_id, user_id)
);

create table delivery.launch_digests (
  id        uuid primary key default gen_random_uuid(),
  launch_id uuid not null references delivery.launches(id) on delete cascade,
  shared_by uuid references core.users(id) on delete set null,
  shared_at timestamptz not null default now(),
  emailed   integer not null default 0,
  in_slack  boolean not null default false,
  body      text not null
);
create index launch_digests_launch_idx on delivery.launch_digests (launch_id, shared_at desc);
