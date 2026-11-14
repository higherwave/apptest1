-- 0045_launch_stages.sql
-- Launch updates: reviewers are kept informed from the storyboard onward, and approvals open only once requirements are published.
--   delivery.launches.asked_at          when the launch's owner first asked for answers (the launch is then "ready for approval").
--   core.memberships.reviewing_unavailable  a reviewer who is away: their alternates are the active reviewers (and get the messages) until it is switched off.
--   core.projects.storyboard_failed_at  when the storyboard last failed to write itself after an analysis; cleared when one is written.
-- Backward compatible: new nullable or defaulted columns the previous code ignores.

alter table delivery.launches add column asked_at timestamptz;
alter table core.memberships add column reviewing_unavailable boolean not null default false;
alter table core.projects add column storyboard_failed_at timestamptz;
