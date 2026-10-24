-- A published requirements document can be edited again. Two things are needed to keep it honest:
--  * which steps were written before an earlier step last changed (so they can be marked "behind");
--  * a note on a board story the document no longer agrees with (kept, never silently deleted).
alter table core.agent_steps
  add column drafted_at timestamptz,
  add column content_changed_at timestamptz;
update core.agent_steps set drafted_at = updated_at, content_changed_at = updated_at where status <> 'pending';

alter table delivery.stories add column sync_note text;
