-- 0006_color_keys.sql
-- Cards are coloured by a tint token name, never a raw hex value, so pages can map the name to
-- var(--at-tint-<name>). The allowed names match the --at-tint-* tokens in src/theme.scss.

update core.projects set color = case lower(color)
  when '#faf3e6' then 'cream'  when '#e4f3ec' then 'mint'     when '#fbf3cf' then 'yellow'
  when '#fbe9e0' then 'coral'  when '#eeeafa' then 'lavender' when '#e6f2fa' then 'sky'
  when '#eef2fa' then 'blue'   when '#fae6ed' then 'rose'     when '#fddcc6' then 'peach'
  when '#faf1df' then 'sand'   else 'cream' end
where color like '#%';

update insights.case_studies set color = case lower(color)
  when '#faf3e6' then 'cream'  when '#e4f3ec' then 'mint'     when '#fbf3cf' then 'yellow'
  when '#fbe9e0' then 'coral'  when '#eeeafa' then 'lavender' when '#e6f2fa' then 'sky'
  when '#eef2fa' then 'blue'   when '#fae6ed' then 'rose'     when '#fddcc6' then 'peach'
  when '#faf1df' then 'sand'   else 'cream' end
where color like '#%';

alter table core.projects alter column color set default 'cream';
alter table insights.case_studies alter column color set default 'cream';

alter table core.projects add constraint projects_color_tint
  check (color in ('cream','mint','yellow','coral','lavender','sky','blue','rose','peach','sand'));
alter table insights.case_studies add constraint case_studies_color_tint
  check (color in ('cream','mint','yellow','coral','lavender','sky','blue','rose','peach','sand'));
