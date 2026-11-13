-- 0042_launch_slack.sql
-- Launch, slice 5: the Slack channel a team's launches are announced in, and the thread each launch has there.
--   core.teams.slack_channel         the channel name without "#" (set by a workspace owner); null means the team's launches are not posted to Slack.
--   delivery.launches.slack_*        where the launch's thread is: the channel id, the first message's timestamp and its link.
--   delivery.launch_slack_posts      one row per message Signal Flow has posted, so a message goes once (the dedupe key says which event).
-- Backward compatible: new nullable columns and a new table the previous code ignores.

alter table core.teams add column slack_channel text;
alter table delivery.launches add column slack_channel_id text, add column slack_thread_ts text, add column slack_permalink text;

create table delivery.launch_slack_posts (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references delivery.launches(id) on delete cascade,
  kind        text not null,
  dedupe_key  text not null,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  ts          text,
  error       text,
  created_at  timestamptz not null default now(),
  unique (launch_id, dedupe_key)
);
