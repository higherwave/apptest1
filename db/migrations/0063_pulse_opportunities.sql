-- Pulse slice 7: Salesforce opportunity notes as signals, and what is at stake behind them (the opportunity's amount, stage and close date).
-- Only the fields an owner designates are read. Backward compatible: columns are nullable, and the checks are only widened (the previous code never writes the new values).
alter table core.pulse_signals drop constraint pulse_signals_channel_check;
alter table core.pulse_signals add constraint pulse_signals_channel_check check (channel in ('slack', 'call_notes', 'salesforce', 'support_tickets', 'conference', 'other'));
alter table core.pulse_signals drop constraint pulse_signals_source_check;
alter table core.pulse_signals add constraint pulse_signals_source_check check (source in ('manual', 'notes', 'slack', 'salesforce'));
alter table core.pulse_weights drop constraint pulse_weights_channel_check;
alter table core.pulse_weights add constraint pulse_weights_channel_check check (channel in ('slack', 'call_notes', 'salesforce', 'support_tickets', 'conference', 'other'));
alter table core.pulse_sources drop constraint pulse_sources_channel_check;
alter table core.pulse_sources add constraint pulse_sources_channel_check check (channel in ('slack', 'call_notes', 'salesforce', 'support_tickets', 'conference', 'other'));
alter table core.pulse_sources drop constraint pulse_sources_kind_check;
alter table core.pulse_sources add constraint pulse_sources_kind_check check (kind in ('slack', 'salesforce_opportunity'));

-- What a source reads beyond its name: for opportunity notes, the fields, the scope and the amount field.
alter table core.pulse_sources add column config jsonb not null default '{}'::jsonb;

-- The opportunity behind a signal from Salesforce. The account's own Salesforce id lets its ARR be found exactly, without matching names.
alter table core.pulse_signals add column account_sf_id text;
alter table core.pulse_signals add column opp_id text;
alter table core.pulse_signals add column opp_name text;
alter table core.pulse_signals add column opp_amount numeric(16, 2);
alter table core.pulse_signals add column opp_stage text;
alter table core.pulse_signals add column opp_close_date date;
-- open: still being worked (counts as in play); lost: closed without a win; won: closed with a win (counted in neither).
alter table core.pulse_signals add column opp_state text check (opp_state in ('open', 'lost', 'won'));
