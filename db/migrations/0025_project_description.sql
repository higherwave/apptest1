-- 0025_project_description.sql
-- The test plan's "What are we testing?" items become one Project Description: a short, high-level orientation for the whole project,
-- kept in research.studies.what_testing (the study row already had it). What people wrote is carried over, not lost: each project's item
-- descriptions are joined (one paragraph per item) into its description, and the "outcome expected" lines are kept on the study row
-- (research.studies.outcomes) where the requirements draft reads them. Questions and tasks are where specifics live now.
-- research.test_items stays for now and is no longer read: dropping it is a later release, so the previous code can still run.
-- Backward compatible: this only fills columns that already exist.

update research.studies s
set what_testing = coalesce(
      nullif(btrim(s.what_testing), ''),
      (select nullif(string_agg(btrim(i.description), E'\n\n' order by i.position) filter (where btrim(coalesce(i.description, '')) <> ''), '')
         from research.test_items i where i.project_id = s.project_id)),
    outcomes = case
      when cardinality(s.outcomes) > 0 then s.outcomes
      else coalesce((select array_agg(u.o order by i.position, u.n)
                       from research.test_items i, unnest(i.outcomes) with ordinality as u(o, n)
                      where i.project_id = s.project_id and btrim(u.o) <> ''), '{}')
    end
where exists (select 1 from research.test_items i where i.project_id = s.project_id);
