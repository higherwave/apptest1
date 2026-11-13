-- 0041_notification_held.sql
-- A message the app chose not to send (the temporary recipient limit is on, or the address is a placeholder) is kept with status 'held', so it is on record
-- and can still be sent later. Backward compatible: the previous code never writes this status and only reads rows it made.
alter table core.notifications drop constraint notifications_status_check;
alter table core.notifications add constraint notifications_status_check check (status in ('pending', 'sent', 'failed', 'held'));
