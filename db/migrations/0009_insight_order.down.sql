-- Rolls back 0009_insight_order.sql
alter table insights.recommendations drop column position;
alter table insights.platform_themes drop column position;
