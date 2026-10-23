-- A project has one requirements document. The API already returns the existing one instead of making another; this makes the
-- rule permanent. (Stand-alone documents each live in a project of their own, so it holds for them too.)
create unique index specs_one_per_project on delivery.specs (project_id);
