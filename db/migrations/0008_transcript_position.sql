-- 0008_transcript_position.sql
-- Transcripts are shown in the order they were added, so the order is stored (as for participants).

alter table research.transcripts add column position integer not null default 0;

update research.transcripts t set position = o.rn - 1
from (
  select id, row_number() over (partition by project_id order by created_at, name, id) as rn
  from research.transcripts
) o
where o.id = t.id;

create index transcripts_project_position_idx on research.transcripts (project_id, position);
