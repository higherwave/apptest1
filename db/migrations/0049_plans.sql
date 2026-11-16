-- Multi-tenancy, step 4: a plan per workspace, with the limits that come from it. The numbers are data, so changing a pilot's AI cap is an update, not a deploy.
-- A workspace with no plan keeps the deployment's own settings (AI_MONTHLY_BUDGET_USD), so nothing changes for it.
create table core.plans (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name           text not null,
  ai_monthly_usd numeric(10, 2) not null check (ai_monthly_usd >= 0),  -- the AI spend cap per month
  seats          integer check (seats > 0),                            -- people in the workspace; null = no limit set
  storage_mb     integer check (storage_mb > 0),                       -- reported against, not yet enforced; null = no limit set
  sort           integer not null default 0,
  created_at     timestamptz not null default now()
);
-- The pilot plan: the owner funds the first pilots with a $20 monthly AI cap each. Seats and storage have no limit until one is chosen.
insert into core.plans (key, name, ai_monthly_usd, sort) values ('pilot', 'Pilot', 20, 10);

alter table core.workspaces add column plan_key text references core.plans(key);
alter table core.workspaces add column ai_monthly_usd numeric(10, 2) check (ai_monthly_usd >= 0);  -- overrides the plan's cap for this one workspace

-- Plans and a workspace's plan are the platform's to change, never a workspace's own request: the restricted role may only read them.
revoke insert, update, delete on core.plans from sf_app;
revoke insert, update, delete on core.workspaces from sf_app;

-- The whole month's AI spend across every workspace, as one number, for the platform ceiling. Nothing else of another workspace is reachable.
create function core.platform_ai_spend_this_month() returns numeric language sql stable security definer set search_path = core, public as
$$ select coalesce(sum(cost_usd), 0) from core.ai_usage where created_at >= date_trunc('month', now()) $$;
revoke all on function core.platform_ai_spend_this_month() from public;
grant execute on function core.platform_ai_spend_this_month() to sf_app;
