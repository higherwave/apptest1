# Runbook

How to operate Signal Flow once it is running. Setup for a new environment is in `SETUP.md`.

## Is it up?

- `GET /api/v1/health` returns `{ status, version }` and never touches the database. `version` is the deployed commit's short SHA.
- `GET /api/v1/health/db` (needs access) reaches the database and reports the migration count.
- Neon's free compute pauses when idle: the first request after a pause can answer `503 db_unavailable`; retry once.

## Deploying

Push to `main`. CI runs on the push; the host builds it. On a **production** build the last build step applies pending migrations
(`db/deploy-migrate.mjs`): if it fails, the build fails and the previous deployment keeps serving. Read the build log for the line
`Migrations: database is up to date (N applied)` or `applied NNNN_name.sql`.

A blocked destructive migration says which statement. Review it; if it is intended, add `-- migrate: allow-destructive` to the file
and push again, or apply it by hand (`node db/migrate.mjs up --yes`) and push.

## Rolling back

1. In the host, promote the previous deployment (instant on Vercel). The schema is not rolled back: migrations are written so the
   previous code runs against the new schema.
2. Fix forward in code. Only if a migration itself is wrong: `node db/migrate.mjs down --yes` rolls back the **latest** one and
   deletes that schema's data, so take a database backup or branch first and be sure.

## Access

- First owners: `node db/bootstrap-owners.mjs a@example.com b@example.com --yes` (safe to repeat).
- After that, owners invite, change roles and remove people on the Members page. The last owner cannot be removed.
- Editing mode is set by `OPEN_EDITING` and `PUBLIC_VIEW`; a company deployment runs `OPEN_EDITING=false`.

## AI

| Symptom | Cause and action |
| --- | --- |
| Header says "AI: simulated" | Not configured (`AI_PROVIDER`, `ANTHROPIC_API_KEY`), or `AI_ENABLED=false` |
| Owner banner at 50% / 80% / 100% | Month's spend reached that share of `AI_MONTHLY_BUDGET_USD`. At 100% steps use the simulation until next month or a higher budget |
| `ai_credit_exhausted` in AI status | The provider account is out of credit or at its own limit: top it up |
| `ai_output_unusable` | The model's reply failed validation twice; nothing was saved. Try again; check the problems list for the reason |
| Need to stop all spend now | Set `AI_ENABLED=false` and redeploy: every call becomes the free simulation |

Spend is recorded per call in `core.ai_usage`; owners see problems under Admin > AI usage and costs. Admin > System usage shows the database's size against `DATABASE_SIZE_LIMIT_MB` (default 1024, Neon's free plan; set it to your plan's limit, 0 for none).

## Design thumbnails

| Symptom | Cause and action |
| --- | --- |
| "The thumbnail service could not start" | Chromium did not launch in the function. Read the Vercel function log for `Thumbnail capture: the browser did not start`; check the function has `includeFiles` for `@sparticuz/chromium` (vercel.json) and enough memory and time. Upload still works |
| "That address is on a private network" | By design: only public pages are captured. Upload a screenshot |
| A sign-in page is captured | The prototype is private. Upload a screenshot instead |
| Capture is slow | A cold start takes several seconds; a page that never goes quiet is captured after 20 seconds |
| Need to switch it off | Set `DESIGN_CAPTURE=false` (no redeploy of code needed, only the setting) |

## Secrets

Rotate on any suspicion of exposure, and anything that was ever pasted into a chat. Changing `BETTER_AUTH_SECRET` signs everyone out.
Provider keys and the MCP token can be rotated without a code change: update the setting, redeploy.

| Secret | Where it is used |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | API and migrations (the host's database integration manages them) |
| `BETTER_AUTH_SECRET` | Signs sign-in cookies |
| `OIDC_CLIENT_SECRET` (or `GOOGLE_CLIENT_SECRET`) | Sign-in with your identity provider |
| `ANTHROPIC_API_KEY` | AI calls |
| `DEV_TOKEN` | Optional bearer token for scripts; unset it in a company deployment |

## Database

- Migrations status: `node db/migrate.mjs status` (read-only). Connection strings come from the environment or `db/.env.local`
  (gitignored). Never paste them into chat or commit them.
- Backups and point-in-time restore depend on the database plan: confirm the restore window before real data goes in.
- The in-memory test database means `npm test` never needs a real one.

## Design system

The linter rules and tokens are pinned in `vendor/design-rules/`. When the design-system-mcp repo changes, run `npm run rules:check`
(CI shows it as a non-blocking warning) and `npm run rules:sync`, then commit. A failing `check:tokens` means `theme.scss` and the
registry disagree: fix whichever is wrong, in both places.
