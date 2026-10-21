-- 0005_insights_stats.sql
-- One definition of the Platform Insights counts. Participants are counted once per project even when
-- two themes in that project roll up into the same platform theme; a person is a participant record
-- (or, for an unmatched speaker, a lower-cased name), so the same person in two projects is two
-- participants, as the prototype counts them. Views only: no tables, no stored totals.

-- Per platform theme and project: who raised it and how often.
create view insights.platform_theme_project_stats as
select s.platform_theme_id,
       t.project_id,
       count(distinct t.id)            as theme_count,
       count(distinct tq.utterance_id) as mention_count,
       count(distinct coalesce(sp.participant_id::text, 'sp:' || lower(sp.name))) as participant_count
from insights.platform_theme_sources s
join research.themes t              on t.id = s.theme_id
join research.theme_quotes tq       on tq.theme_id = t.id
join research.utterances u          on u.id = tq.utterance_id
join research.transcript_speakers sp on sp.id = u.speaker_id
group by s.platform_theme_id, t.project_id;

-- Per platform theme: the figures shown as "N of M participants across K of L projects".
create view insights.platform_theme_stats as
select platform_theme_id,
       count(*)                 as project_count,
       sum(participant_count)::bigint as participant_count,
       sum(mention_count)::bigint     as mention_count
from insights.platform_theme_project_stats
group by platform_theme_id;

-- Per workspace: the denominators. Only projects that have themes count.
create view insights.workspace_stats as
select pr.workspace_id,
       count(distinct pr.id) as project_count,
       count(distinct pr.id::text || ':' || coalesce(sp.participant_id::text, 'sp:' || lower(sp.name))) as participant_count
from core.projects pr
join research.transcripts tr           on tr.project_id = pr.id
join research.transcript_speakers sp   on sp.transcript_id = tr.id and sp.role = 'participant'
where exists (select 1 from research.themes th where th.project_id = pr.id)
group by pr.workspace_id;
