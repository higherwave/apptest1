-- Rolls back 0014_reopen_published.sql
alter table delivery.stories drop column sync_note;
alter table core.agent_steps drop column content_changed_at, drop column drafted_at;
