-- Rolls back 0021_platform_theme_curation.sql
drop table insights.merge_suggestions;
alter table insights.platform_themes drop column rationale, drop column rationale_at;
alter table insights.platform_theme_sources drop column reason;
drop table insights.platform_theme_aliases;
