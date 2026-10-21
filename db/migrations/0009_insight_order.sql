-- 0009_insight_order.sql
-- Platform themes and recommendations are shown in a chosen order, not alphabetically or by insert time.
alter table insights.platform_themes add column position integer not null default 0;
alter table insights.recommendations add column position integer not null default 0;
