-- 0007_participant_position.sql
-- Participants are shown in the order they were entered, so the order must be stored. Rows created in
-- one transaction share a timestamp, which would leave their order to chance.

alter table research.participants add column position integer not null default 0;

update research.participants p set position = o.rn - 1
from (
  select id, row_number() over (partition by project_id order by created_at, name, id) as rn
  from research.participants
) o
where o.id = p.id;

create index participants_project_position_idx on research.participants (project_id, position);
