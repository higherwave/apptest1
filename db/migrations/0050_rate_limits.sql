-- Security baseline: a ceiling on how often one person can start the costly things (AI work, PDF exports, thumbnail captures, invitations), kept in the
-- database because the app runs as many short-lived instances that share no memory. A fixed window per person and kind; old windows are swept as it goes.
-- Platform table: only the owner role touches it, never a workspace's own requests.
create table core.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  n            integer not null default 0,
  primary key (bucket, window_start)
);
revoke all on core.rate_limits from sf_app;
