drop view research.theme_stats;
create view research.theme_stats as
with speaker_key as (
  select s.id as speaker_id,
         coalesce(s.participant_id::text, 'sp:' || lower(s.name)) as person_key
  from research.transcript_speakers s
)
select t.id as theme_id,
       t.project_id,
       count(distinct tq.utterance_id) as mention_count,
       count(distinct sk.person_key)   as participant_count,
       (select count(distinct sk2.person_key)
          from research.transcripts tr
          join research.utterances u2 on u2.transcript_id = tr.id
          join research.transcript_speakers s2 on s2.id = u2.speaker_id and s2.role = 'participant'
          join speaker_key sk2 on sk2.speaker_id = s2.id
         where tr.project_id = t.project_id) as total_participants
from research.themes t
left join research.theme_quotes tq on tq.theme_id = t.id
left join research.utterances u    on u.id = tq.utterance_id
left join speaker_key sk           on sk.speaker_id = u.speaker_id
group by t.id, t.project_id;
