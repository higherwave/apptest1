drop table core.pulse_state;
drop table core.pulse_weights;
drop table core.pulse_topic_signals;
drop table core.pulse_topics;
alter table core.pulse_signals drop column kept_at;
alter table core.pulse_signals drop column channel;
