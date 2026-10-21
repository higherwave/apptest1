# Signal Flow

A research-to-requirements workspace: plan a study, analyse transcripts into themes, write a reviewed
requirements document, and track the resulting stories on a board. Built from the Signal Flow prototype
(Claude Design), with React + Carbon + the Airtable style layer, a small API, and Postgres on Neon.

The earlier Whirl pilot app lives at the git tag `archive/old-react-test`.

## Layout

| Path | What |
| --- | --- |
| `src/` | React app (Vite). `theme.scss` and `tokens.scss` are the only files that define colours and type; everything else uses `var(--at-*)` and the `role()` mixin |
| `server/` | The API (Hono): `app.ts` routes, `context.ts` request context, `db.ts` Postgres access, tests beside them |
| `api/index.ts` | Vercel function entry; `vercel.json` rewrites `/api/*` to it |
| `openapi/openapi.yaml` | The API contract. Written first; tests check the routes against it |
| `db/` | Migrations, demo seed and their tests (see `db/README.md`) |
| `scripts/validate-pages.mjs` | Runs the design-system MCP rules over `src/` |

## Commands

    npm run dev          # React app on :5173 (proxies /api to :8787)
    npm run dev:api      # API on :8787; uses db/.env.local when present
    npm test             # API tests + database tests, all on an in-memory Postgres (no Neon compute)
    npm run validate:pages   # MCP design-system rules over src/ (needs ../design-system-mcp)
    npm run check:all    # typecheck + tests + page validation

## Environment variables (Vercel)

The Neon integration adds the database variables (with a custom prefix; the code finds them by suffix).

| Name | Purpose |
| --- | --- |
| `DEV_TOKEN` | Until sign-in exists, data routes require `Authorization: Bearer <DEV_TOKEN>`. If it is unset on a production deployment they are refused (`auth_not_configured`). `/api/v1/health` is always open and never touches the database |
| `DEMO_WORKSPACE_SLUG`, `DEV_USER_EMAIL` | Which demo workspace and user the API acts as. Defaults: `higherwave-demo`, `david@demo.signalflow.example` |

## Cost limits

Neon Free and Vercel Hobby stop at their limits instead of billing. When the database is paused the API returns
`503 db_unavailable` and the app shows a message. Do not add pings or cron jobs that query the database.
