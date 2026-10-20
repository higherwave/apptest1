-- 0002_research.sql
-- Plan and Analyze: test plan, participants, transcripts, analysis output.
-- Dependency rule: research references core only.

create schema research;

create type research.theme_category   as enum ('pain_point', 'need', 'expectation', 'delight');
create type research.speaker_role     as enum ('participant', 'moderator');
create type research.transcript_platform as enum ('zoom', 'meet', 'teams');

-- The test plan, 1:1 with a project.
create table research.studies (
  project_id   uuid primary key references core.projects(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  what_testing text,
  jtbd_when    text,                    -- NULL when empty, never a placeholder dash
  jtbd_want    text,
  jtbd_so      text,
  outcomes     text[] not null default '{}',
  methods      text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);

create table research.study_stages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  study_id     uuid not null references research.studies(project_id) on delete cascade,
  position     smallint not null check (position >= 0),
  name         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1,
  unique (study_id, position)
);

create table research.participants (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id   uuid not null references core.projects(id) on delete cascade,
  name         text not null,
  role         text,
  email        text,
  session_date date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create index participants_project_idx on research.participants (project_id);

-- Questions and their follow-ups (a follow-up is a child task).
create table research.tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  project_id     uuid not null references core.projects(id) on delete cascade,
  parent_task_id uuid references research.tasks(id) on delete cascade,
  position       integer not null default 0,
  prompt         text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1
);
create index tasks_project_idx on research.tasks (project_id, parent_task_id, position);

create table research.transcripts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id   uuid not null references core.projects(id) on delete cascade,
  name         text not null,
  platform     research.transcript_platform,
  raw_text     text not null,
  content_hash text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  version      integer not null default 1
);
create index transcripts_project_idx on research.transcripts (project_id);

-- Maps a name in the transcript text to a participant, or marks a moderator.
create table research.transcript_speakers (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  transcript_id  uuid not null references research.transcripts(id) on delete cascade,
  name           text not null,
  role           research.speaker_role not null default 'participant',
  participant_id uuid references research.participants(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1,
  unique (transcript_id, name)
);

create table research.utterances (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references core.workspaces(id) on delete cascade,
  transcript_id   uuid not null references research.transcripts(id) on delete cascade,
  speaker_id      uuid not null references research.transcript_speakers(id) on delete cascade,
  position        integer not null,
  timestamp_label text,                 -- as written in the transcript, e.g. 00:01:02
  text            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references core.users(id) on delete set null,
  updated_by      uuid references core.users(id) on delete set null,
  version         integer not null default 1,
  unique (transcript_id, position)
);
create index utterances_speaker_idx on research.utterances (speaker_id);

-- Analysis output: one row per theme per analysis run.
create table research.themes (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references core.workspaces(id) on delete cascade,
  project_id         uuid not null references core.projects(id) on delete cascade,
  run_id             uuid not null references core.agent_runs(id) on delete cascade,
  title              text not null,
  category           research.theme_category not null,
  stage_position     smallint check (stage_position >= 0),
  severity           numeric(3,2) check (severity between -1 and 1),
  description        text,
  opportunity        text,
  suggested_priority core.priority_level not null default 'medium',
  suggested_effort   smallint not null default 2 check (suggested_effort between 1 and 3),
  effort_note        text,
  score              numeric(5,4),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references core.users(id) on delete set null,
  updated_by         uuid references core.users(id) on delete set null,
  version            integer not null default 1
);
create index themes_project_run_idx on research.themes (project_id, run_id);

-- The user's edits, kept apart from analysis output. NULL means "use the suggestion".
create table research.theme_overrides (
  theme_id       uuid primary key references research.themes(id) on delete cascade,
  workspace_id   uuid not null references core.workspaces(id) on delete cascade,
  title          text,
  stage_position smallint check (stage_position >= 0),
  priority       core.priority_level,
  effort         smallint check (effort between 1 and 3),
  pinned         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references core.users(id) on delete set null,
  updated_by     uuid references core.users(id) on delete set null,
  version        integer not null default 1
);

create table research.theme_quotes (
  theme_id     uuid not null references research.themes(id) on delete cascade,
  utterance_id uuid not null references research.utterances(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (theme_id, utterance_id)
);
create index theme_quotes_utterance_idx on research.theme_quotes (utterance_id);

-- Participant and mention counts are derived from quotes, so every number traces to a quote.
-- A participant counts once however many transcripts they speak in; an unmatched speaker is
-- keyed by lower-cased name, as the prototype does.
create view research.theme_stats as
with speaker_key as (
  select s.id as speaker_id,
         coalesce(s.participant_id::text, 'sp:' || lower(s.name)) as person_key
  from research.transcript_speakers s
)
select t.id as theme_id,
       t.project_id,
       count(distinct tq.utterance_id) as mention_count,
       count(distinct sk.person_key)   as participant_count,
       (select count(distinct sk2.person_key)
          from research.transcripts tr
          join research.utterances u2 on u2.transcript_id = tr.id
          join research.transcript_speakers s2 on s2.id = u2.speaker_id and s2.role = 'participant'
          join speaker_key sk2 on sk2.speaker_id = s2.id
         where tr.project_id = t.project_id) as total_participants
from research.themes t
left join research.theme_quotes tq on tq.theme_id = t.id
left join research.utterances u    on u.id = tq.utterance_id
left join speaker_key sk           on sk.speaker_id = u.speaker_id
group by t.id, t.project_id;

do $$
declare t text;
begin
  foreach t in array array[
    'research.studies', 'research.study_stages', 'research.participants', 'research.tasks',
    'research.transcripts', 'research.transcript_speakers', 'research.utterances',
    'research.themes', 'research.theme_overrides'
  ] loop
    execute format('create trigger touch before update on %s for each row execute function core.touch()', t);
  end loop;

  foreach t in array array[
    'research.studies', 'research.study_stages', 'research.participants', 'research.tasks',
    'research.transcripts', 'research.transcript_speakers', 'research.utterances',
    'research.themes', 'research.theme_overrides', 'research.theme_quotes'
  ] loop
    execute format('create index on %s (workspace_id)', t);
  end loop;
end $$;
