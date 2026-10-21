-- Rolls back 0008_transcript_position.sql
drop index if exists research.transcripts_project_position_idx;
alter table research.transcripts drop column position;
