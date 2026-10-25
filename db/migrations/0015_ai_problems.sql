-- 0015_ai_problems.sql
-- The last things that went wrong with a model call (a refused reply, an out-of-credit account, an unreachable service), so an owner can
-- see why drafting or analysis failed or fell back to the simulation. Only the problem is stored, never any research text.
create table core.ai_problems (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references core.workspaces(id) on delete cascade,
  purpose       text not null,                 -- 'analysis', 'spec_step' or 'theme_match'
  code          text not null,                 -- for example ai_output_unusable, ai_credit_exhausted, ai_budget_reached
  message       text not null,
  detail        text,
  created_at    timestamptz not null default now()
);
create index ai_problems_workspace_idx on core.ai_problems (workspace_id, created_at desc);
