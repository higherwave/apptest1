update core.notifications set status = 'failed', error = coalesce(error, 'held') where status = 'held';
alter table core.notifications drop constraint notifications_status_check;
alter table core.notifications add constraint notifications_status_check check (status in ('pending', 'sent', 'failed'));
