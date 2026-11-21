delete from core.workspace_integrations where kind = 'salesforce';
alter table core.workspace_integrations drop constraint workspace_integrations_kind_check;
alter table core.workspace_integrations add constraint workspace_integrations_kind_check check (kind in ('slack', 'jira'));
drop table core.pulse_account_sync;
drop table core.pulse_accounts;
