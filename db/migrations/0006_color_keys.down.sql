-- Rolls back 0006_color_keys.sql: restores hex values and the old defaults.
alter table core.projects drop constraint projects_color_tint;
alter table insights.case_studies drop constraint case_studies_color_tint;
update core.projects set color = case color
  when 'cream' then '#faf3e6' when 'mint' then '#e4f3ec' when 'yellow' then '#fbf3cf' when 'coral' then '#fbe9e0'
  when 'lavender' then '#eeeafa' when 'sky' then '#e6f2fa' when 'blue' then '#eef2fa' when 'rose' then '#fae6ed'
  when 'peach' then '#fddcc6' when 'sand' then '#faf1df' else '#faf3e6' end;
update insights.case_studies set color = case color
  when 'cream' then '#faf3e6' when 'mint' then '#e4f3ec' when 'yellow' then '#fbf3cf' when 'coral' then '#fbe9e0'
  when 'lavender' then '#eeeafa' when 'sky' then '#e6f2fa' when 'blue' then '#eef2fa' when 'rose' then '#fae6ed'
  when 'peach' then '#fddcc6' when 'sand' then '#faf1df' else '#faf3e6' end;
alter table core.projects alter column color set default '#faf3e6';
alter table insights.case_studies alter column color set default '#faf3e6';
