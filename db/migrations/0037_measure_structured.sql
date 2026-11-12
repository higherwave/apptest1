-- 0037_measure_structured.sql
-- Measure, entered as one sentence: "We'll know this worked when <what> <detail> <go from | stay below | rise above | stay between | reach> <value> [to <value>] <unit>".
-- The parts are kept as columns so the sentence can be read back and edited; metric, baseline and target are still written (from the parts) so
-- everything that reads them, including Platform Insights and the case studies, keeps working. Rows saved before this have none of the parts and
-- are shown from metric, baseline and target as they were.
-- trend: a short series of readings (oldest first) for a small chart. Nothing in the app writes it yet: it is what a connected data source will
-- fill, and for now it is sample data in the demo.
-- Backward compatible: nullable columns the previous code ignores.
alter table delivery.success_measures
  add column metric_kind text check (metric_kind in ('tickets', 'adoption', 'engagement', 'time_to_value', 'retention', 'feedback', 'other')),
  add column detail      text,
  add column comparison  text check (comparison in ('change', 'below', 'above', 'between', 'reach')),
  add column value_a     text,
  add column value_b     text,
  add column unit        text,
  add column trend       jsonb check (trend is null or jsonb_typeof(trend) = 'array');
