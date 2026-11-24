-- 0067_pulse_demo.sql
-- A second workspace feature switch: whether Pulse is shown, read-only, to the public demo visitor. Off unless an owner turns it on.
alter table core.workspace_features drop constraint if exists workspace_features_feature_check;
alter table core.workspace_features add constraint workspace_features_feature_check check (feature in ('pulse', 'pulse_demo'));
