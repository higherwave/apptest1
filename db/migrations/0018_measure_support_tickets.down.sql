-- Rolls back 0018_measure_support_tickets.sql
update delivery.success_measures set source = 'other' where source = 'support_tickets';
alter table delivery.success_measures drop constraint success_measures_source_check;
alter table delivery.success_measures add constraint success_measures_source_check
  check (source in ('telemetry', 'kpi', 'research', 'other'));
