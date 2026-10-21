-- Rolls back 0010_ai_usage.sql
drop index core.agent_runs_one_running_analysis;
drop table core.ai_usage;
