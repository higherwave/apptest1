# Signal Flow database

31 tables in four schemas: `core` (9), `research` (10), `delivery` (6), `insights` (6).
Dependency rule: `core` <- `research` <- `delivery`, `insights`. A schema references only schemas to its left.
Deletes are hard deletes; foreign keys cascade.

## Test without Neon (no compute used)

    cd db && npm install
    npm run check    # dependency rule
    npm test         # applies every migration to an in-memory Postgres, runs 19 checks, rolls back, re-applies

## Apply to Neon

1. In Vercel, open the `apptest1` project, then Settings, then Environment Variables. The Neon integration manages
   the connection strings; here they carry a custom prefix (for example `bizprocess..._DATABASE_URL_UNPOOLED`).
   Do not delete or edit them. Reveal and copy the `..._DATABASE_URL_UNPOOLED` value and the `..._DATABASE_URL` value.
2. Create `db/.env.local` (gitignored by the `*.local` rule). Never commit it or paste it into chat. Any prefix works,
   because the runner matches by suffix:

        DATABASE_URL_UNPOOLED=postgres://...
        DATABASE_URL=postgres://...

3. Check what would happen, then apply:

        npm run status               # read-only: shows target host, applied and pending
        node migrate.mjs up          # dry run
        node migrate.mjs up --yes    # applies each migration in its own transaction

`down --yes` rolls back the most recent migration and deletes that schema's data.

## Neon Free limits

Compute suspends after 5 minutes idle. Run tests and daily work with `npm test` (in-memory), and use Neon only for the
deployed demo. Do not add health checks or pings that query the database.

## Demo data

Built from the prototype's own sample data (extracted to `seed/data/*.json`, never retyped):
4 projects (3 analysed, 1 draft), 13 transcripts, 17 themes, one published board (10 stories), and the Platform Insights rows.

    npm run test:seed             # in-memory check, no Neon compute
    node seed/seed.mjs            # dry run against Neon: shows what would change
    node seed/seed.mjs --yes      # reset and reload the demo workspace (one transaction)
    npm run seed:extract          # re-extract from the prototype when it changes

The reset touches only the workspace `higherwave-demo` and users at `@demo.signalflow.example`. Ids are derived from
names, so links stay stable across resets.

Participant counts for a platform theme must count distinct people per project. Summing per-theme counts double-counts when
two themes in one project roll up into the same platform theme (project 1 has two prep-checklist themes).
