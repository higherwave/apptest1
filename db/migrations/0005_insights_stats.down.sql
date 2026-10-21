-- Rolls back 0005_insights_stats.sql
drop view if exists insights.workspace_stats;
drop view if exists insights.platform_theme_stats;
drop view if exists insights.platform_theme_project_stats;
