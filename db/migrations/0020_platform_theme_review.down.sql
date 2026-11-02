-- Rolls back 0020_platform_theme_review.sql
alter table insights.platform_themes drop column needs_review;
