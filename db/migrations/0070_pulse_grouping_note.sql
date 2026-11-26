-- 0070_pulse_grouping_note.sql
-- How the topics were last grouped, so the Topics page can say so plainly: by an AI model (which one) or by the built-in simulation, and why the
-- simulation was used when it was a fallback. Only a label and a time: nothing about the signals themselves. Backward compatible: new nullable
-- columns the previous code ignores.
alter table core.pulse_state
  add column grouped_by       text check (grouped_by in ('model', 'simulation')),
  add column grouped_model    text,
  add column grouped_fallback text check (grouped_fallback in ('budget', 'credit')),
  add column grouped_at       timestamptz;
