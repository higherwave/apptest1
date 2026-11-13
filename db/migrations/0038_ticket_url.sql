-- 0038_ticket_url.sql
-- A ticket made in a real Jira keeps the address of its issue, so Sent to Jira can link to it. Null for a simulated ticket.
-- Backward compatible: a new nullable column the previous code ignores.
alter table delivery.story_tickets add column jira_url text;
