-- 0018_measure_support_tickets.sql
-- A measure's number can also come from support tickets.
alter table delivery.success_measures drop constraint success_measures_source_check;
alter table delivery.success_measures add constraint success_measures_source_check
  check (source in ('telemetry', 'kpi', 'support_tickets', 'research', 'other'));
