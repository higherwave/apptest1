-- Rolls back 0019_session_length.sql
alter table research.participants drop column session_minutes;
