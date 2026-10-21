-- Rolls back 0007_participant_position.sql
drop index if exists research.participants_project_position_idx;
alter table research.participants drop column position;
