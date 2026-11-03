-- 0030_transcript_source.sql
-- Where a transcript came from: a session with a customer, or a conversation with the team (CSMs, Support, Sales, ...). Both are read by the
-- same analysis and end up in the same themes; the source lets each theme say where it was heard, and keeps team feedback out of customer reach.
-- Backward compatible: a new column with a default, so existing rows and the previous code keep working.

alter table research.transcripts add column source text not null default 'customer' check (source in ('customer', 'team'));
