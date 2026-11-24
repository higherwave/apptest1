delete from core.workspace_features where feature = 'pulse_demo';
alter table core.workspace_features drop constraint if exists workspace_features_feature_check;
alter table core.workspace_features add constraint workspace_features_feature_check check (feature in ('pulse'));
