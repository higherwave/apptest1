-- Pulse's first version listens to customer-meeting call notes and Slack only (2026-11-21). Signals and sources filed under the older channels (support tickets, conference, other)
-- are counted as call notes, so nothing drops out of a topic's score. The check constraints still allow the older values, so the previous code keeps working during a deploy.
update core.pulse_signals set channel = 'call_notes' where channel in ('support_tickets', 'conference', 'other');
update core.pulse_sources set channel = 'call_notes' where channel in ('support_tickets', 'conference', 'other');
