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
