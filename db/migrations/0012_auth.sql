-- 0012_auth.sql
-- Sign-in. Better Auth (running inside the API) keeps its accounts, sessions and provider links in these four
-- tables. They are in public with an auth_ prefix, not in their own schema, because Neon's pooled connections do
-- not accept a search_path startup option. Names and columns are mapped in server/auth.ts.
-- core.users.auth_subject (already there) holds auth_user.id once a person's first sign-in links them to their
-- invitation, which is a core.users row plus a core.memberships row.

create table public.auth_user (
  id             text primary key,
  name           text not null,
  email          text not null unique,
  email_verified boolean not null default false,
  image          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.auth_session (
  id          text primary key,
  expires_at  timestamptz not null,
  token       text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  ip_address  text,
  user_agent  text,
  user_id     text not null references public.auth_user(id) on delete cascade
);
create index auth_session_user_id_idx on public.auth_session (user_id);

create table public.auth_account (
  id                       text primary key,
  account_id               text not null,
  provider_id              text not null,
  user_id                  text not null references public.auth_user(id) on delete cascade,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index auth_account_user_id_idx on public.auth_account (user_id);

create table public.auth_verification (
  id          text primary key,
  identifier  text not null,
  value       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index auth_verification_identifier_idx on public.auth_verification (identifier);
