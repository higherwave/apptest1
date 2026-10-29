-- 0019_session_length.sql
-- A participant's planned session length in minutes (30, 45 or 60). The test plan no longer asks for a session date, which is only known
-- once the session is scheduled; the old session_date column stays, unused, so nothing already saved is lost.
alter table research.participants add column session_minutes smallint
  check (session_minutes in (30, 45, 60));
