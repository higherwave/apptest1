-- The company sign-in (OIDC) can send the groups a person belongs to. They are kept on the account at each sign-in so the
-- API can turn them into a role (SSO_*_GROUPS). A JSON array of group names; empty or null when the provider sent none.
-- Backward compatible: the previous code ignores the column.

alter table public.auth_user add column groups text;
