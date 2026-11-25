-- 0068_pulse_hubspot.sql
-- HubSpot support tickets as a Pulse channel (read only). A workspace can connect HubSpot (a service key), designate its tickets as a source, and the tickets become signals in the
-- support_tickets channel (that channel was already allowed). Three checks are widened to say so.
alter table core.workspace_integrations drop constraint if exists workspace_integrations_kind_check;
alter table core.workspace_integrations add constraint workspace_integrations_kind_check check (kind in ('slack', 'jira', 'salesforce', 'hubspot'));
alter table core.pulse_signals drop constraint if exists pulse_signals_source_check;
alter table core.pulse_signals add constraint pulse_signals_source_check check (source in ('manual', 'notes', 'slack', 'salesforce', 'hubspot'));
alter table core.pulse_sources drop constraint if exists pulse_sources_kind_check;
alter table core.pulse_sources add constraint pulse_sources_kind_check check (kind in ('slack', 'salesforce_opportunity', 'hubspot_tickets'));
