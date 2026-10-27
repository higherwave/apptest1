-- 0016_design_items.sql
-- The Design step: for each requirement story, a link to its prototype, a thumbnail of it and the design notes (alternatives
-- explored, rationale). One row per story, made when something is first saved. The thumbnail is a small downscaled image kept
-- in the row, so there is no file store to run.
create table delivery.design_items (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  story_id       uuid not null unique references delivery.stories(id) on delete cascade,
  prototype_url  text,
  notes          text,
  image          bytea,
  image_type     text check (image_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1,
  check ((image is null) = (image_type is null))
);

create trigger touch before update on delivery.design_items for each row execute function core.touch();
