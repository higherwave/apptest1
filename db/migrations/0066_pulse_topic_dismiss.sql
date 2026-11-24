-- 0066_pulse_topic_dismiss.sql
-- Pulse without manual curation: every signal counts at once (nothing waits for review), and a person can dismiss a whole TOPIC instead.
-- A dismissed topic stays hidden until three or more new signals have joined it since (dismissed_signal_count is how many it had when it was dismissed).
alter table core.pulse_topics
  add column dismissed_at timestamptz,
  add column dismissed_signal_count integer,
  add column dismissed_by uuid references core.users(id) on delete set null;

-- Signals that were waiting for review now count.
update core.pulse_signals set status = 'kept', kept_at = coalesce(kept_at, now()) where status = 'new';
