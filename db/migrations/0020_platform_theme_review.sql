-- 0020_platform_theme_review.sql
-- A platform theme the model started because no existing one fit a project theme. It is shown with a "New, review" tag until
-- someone looks at it and marks it reviewed. Themes from the seed and hand-made ones are never flagged.
alter table insights.platform_themes add column needs_review boolean not null default false;
