delete from core.pulse_sources where kind = 'hubspot_tickets';
delete from core.pulse_signals where source = 'hubspot';
delete from core.workspace_integrations where kind = 'hubspot';
alter table core.pulse_sources drop constraint if exists pulse_sources_kind_check;
alter table core.pulse_sources add constraint pulse_sources_kind_check check (kind in ('slack', 'salesforce_opportunity'));
alter table core.pulse_signals drop constraint if exists pulse_signals_source_check;
alter table core.pulse_signals add constraint pulse_signals_source_check check (source in ('manual', 'notes', 'slack', 'salesforce'));
alter table core.workspace_integrations drop constraint if exists workspace_integrations_kind_check;
alter table core.workspace_integrations add constraint workspace_integrations_kind_check check (kind in ('slack', 'jira', 'salesforce'));
