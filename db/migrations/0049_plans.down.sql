drop function core.platform_ai_spend_this_month();
alter table core.workspaces drop column ai_monthly_usd;
alter table core.workspaces drop column plan_key;
drop table core.plans;
grant insert, update, delete on core.workspaces to sf_app;
