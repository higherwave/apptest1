-- 0010_ai_usage.sql
-- Spend ledger for live AI calls (the budget guard sums it per month) and the one-running-analysis-per-project rule.
create table core.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references core.workspaces(id) on delete cascade,
  run_id        uuid references core.agent_runs(id) on delete set null,
  purpose       text not null,                 -- 'analysis', 'spec_step' or 'theme_match'
  provider      text not null,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  created_at    timestamptz not null default now()
);
create index ai_usage_workspace_month_idx on core.ai_usage (workspace_id, created_at);

create unique index agent_runs_one_running_analysis on core.agent_runs (project_id) where kind = 'analysis' and status = 'running';
