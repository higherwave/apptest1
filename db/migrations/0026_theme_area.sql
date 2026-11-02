-- 0026_theme_area.sql
-- The feature area a theme is about, chosen by the analysis (from the questions and areas it is given) and correctable by a person.
-- A theme with no area is still a theme: an area is a label, never a gate. Backward compatible: a new nullable column.

alter table research.themes add column area_id uuid references insights.feature_areas(id) on delete set null;
create index themes_area_idx on research.themes (area_id) where area_id is not null;
