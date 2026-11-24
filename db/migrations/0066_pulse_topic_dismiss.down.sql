-- The signals that were waiting for review and are now kept are not put back.
alter table core.pulse_topics drop column dismissed_by, drop column dismissed_signal_count, drop column dismissed_at;
