-- Rolls back 0011_test_items.sql: the first test item goes back into the single description and outcomes list.
update research.studies s set what_testing = i.description, outcomes = i.outcomes
from research.test_items i where i.project_id = s.project_id and i.position = (select min(position) from research.test_items where project_id = s.project_id);
alter table research.participants drop column phone;
drop table research.test_items;
