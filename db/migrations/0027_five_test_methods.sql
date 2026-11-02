-- 0027_five_test_methods.sql
-- Test methods are now five: Contextual (walk-through), User Discussions, Usability Test, Support or CSM channels, Survey.
-- Projects and templates that carry the earlier seven are moved onto them, keeping order and dropping repeats:
--   Moderated usability test, Unmoderated test, Card sort -> Usability Test
--   Contextual interview                                   -> Contextual (walk-through)
--   Diary study, Concept test                              -> User Discussions
--   Survey follow-up                                       -> Survey
-- Safe to run again (a new name maps to itself). Backward compatible: the previous code only reads these as text.

update research.studies s
set methods = coalesce((
  select array_agg(m order by first_pos)
  from (
    select m, min(ord) as first_pos
    from (
      select case x
               when 'Moderated usability test' then 'Usability Test' when 'Unmoderated test' then 'Usability Test' when 'Card sort' then 'Usability Test'
               when 'Contextual interview' then 'Contextual (walk-through)' when 'Diary study' then 'User Discussions' when 'Concept test' then 'User Discussions'
               when 'Survey follow-up' then 'Survey' else x end as m, ord
      from unnest(s.methods) with ordinality as u(x, ord)
    ) mapped
    where m in ('Contextual (walk-through)', 'User Discussions', 'Usability Test', 'Support or CSM channels', 'Survey')
    group by m
  ) firsts), '{}')
where cardinality(s.methods) > 0;

update core.templates t
set body = jsonb_set(t.body, '{methods}', coalesce((
  select jsonb_agg(m order by first_pos)
  from (
    select m, min(ord) as first_pos
    from (
      select case x
               when 'Moderated usability test' then 'Usability Test' when 'Unmoderated test' then 'Usability Test' when 'Card sort' then 'Usability Test'
               when 'Contextual interview' then 'Contextual (walk-through)' when 'Diary study' then 'User Discussions' when 'Concept test' then 'User Discussions'
               when 'Survey follow-up' then 'Survey' else x end as m, ord
      from jsonb_array_elements_text(t.body -> 'methods') with ordinality as u(x, ord)
    ) mapped
    where m in ('Contextual (walk-through)', 'User Discussions', 'Usability Test', 'Support or CSM channels', 'Survey')
    group by m
  ) firsts), '[]'::jsonb))
where jsonb_typeof(t.body -> 'methods') = 'array';
