-- A workspace's address is <slug>.<our domain>, so the platform's own names can never be a customer's slug (the same list as shared/reserved-slugs.mjs, and
-- a test keeps them equal). Existing workspaces are not affected: none of them uses one. Also pins the slug's shape, as the address needs it.
alter table core.workspaces add constraint workspace_slug_not_reserved check (slug <> all (array['www', 'app', 'api', 'admin', 'auth', 'login', 'sign-in', 'signin', 'status', 'staff', 'mail', 'docs', 'help', 'support', 'static', 'assets', 'cdn', 'dev', 'staging', 'test']));
alter table core.workspaces add constraint workspace_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}[a-z0-9]$');
