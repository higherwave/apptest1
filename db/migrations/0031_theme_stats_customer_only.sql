-- 0031_theme_stats_customer_only.sql
-- Reach is what customers said. Participant and mention counts now come from customer transcripts only; team transcripts (internal
-- conversations with CSMs, Support, Sales) are counted separately as confirmation: team_mention_count and team_session_count.
-- The existing columns keep their names, types and order, so the previous code keeps working; every existing transcript is a
-- customer one, so nothing changes until a team transcript is added.

create or replace view research.theme_stats as
with speaker_key as (
  select s.id as speaker_id,
         coalesce(s.participant_id::text, 'sp:' || lower(s.name)) as person_key
  from research.transcript_speakers s
)
select t.id as theme_id,
       t.project_id,
       count(distinct tq.utterance_id) filter (where tr.source = 'customer') as mention_count,
       count(distinct sk.person_key)   filter (where tr.source = 'customer') as participant_count,
       (select count(distinct sk2.person_key)
          from research.transcripts tr2
          join research.utterances u2 on u2.transcript_id = tr2.id
          join research.transcript_speakers s2 on s2.id = u2.speaker_id and s2.role = 'participant'
          join speaker_key sk2 on sk2.speaker_id = s2.id
         where tr2.project_id = t.project_id and tr2.source = 'customer') as total_participants,
       count(distinct tq.utterance_id) filter (where tr.source = 'team') as team_mention_count,
       count(distinct tr.id)           filter (where tr.source = 'team') as team_session_count
from research.themes t
left join research.theme_quotes tq on tq.theme_id = t.id
left join research.utterances u    on u.id = tq.utterance_id
left join research.transcripts tr  on tr.id = u.transcript_id
left join speaker_key sk           on sk.speaker_id = u.speaker_id
group by t.id, t.project_id;
