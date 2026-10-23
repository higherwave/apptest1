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
| `OPEN_EDITING` | On by default in the Vercel entry (`api/index.ts`) until you turn it off: a request with no token acts as the demo owner and can edit and delete anything (a wrong token is still refused). Set it to `false` in Vercel to require an invitation to edit; with `PUBLIC_VIEW` on (the default), a visitor who is not signed in can still look around, read-only. Local runs and tests are closed unless they set it to `true`. Turn it off before real data or a live AI provider is added, because anyone with the link could then start runs and change data |
| `PUBLIC_VIEW` | On by default in the Vercel entry. With sign-in configured and editing closed, a visitor with no session can read (GET and HEAD) as the read-only demo viewer, so a demo link works without a login. Set it to `false` to require sign-in even to look. With sign-in on, the API tells the CDN not to cache anything, because the CDN's cache is not keyed by cookie |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth client (Web application) for sign-in. Its authorized redirect URIs are `<BETTER_AUTH_URL>/api/v1/auth/callback/google` for each address the app is served from, for example `https://apptest1-eta.vercel.app/api/v1/auth/callback/google` and `http://localhost:5198/api/v1/auth/callback/google`. Mark the secret Sensitive in Vercel and keep a copy in a password manager |
| `BETTER_AUTH_URL` | The address the app is served from, for example `https://apptest1-eta.vercel.app`. Locally, `http://localhost:5198` in `db/.env.local` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional. Other addresses the app is served from, comma-separated, for example the old `vercel.app` address while moving to your own domain. `BETTER_AUTH_URL` is always trusted |
| `BETTER_AUTH_SECRET` | A random string of 32 or more characters that signs sign-in cookies (for example `openssl rand -base64 32`). Changing it signs everyone out. Sign-in is on only when all four of the variables above are set |
| `DEMO_WORKSPACE_SLUG`, `DEV_USER_EMAIL` | Which demo workspace and user the API acts as. Defaults: `higherwave-demo`, `david@demo.signalflow.example` |

## Sign-in and roles

Sign-in is Google only, run by Better Auth inside the API (`server/auth.ts`, routes under `/api/v1/auth`), with its
tables in migration `0012_auth.sql`. Access is by invitation: a person is a `core.users` row (their email) with a
`core.memberships` row (owner, editor or viewer). Their first Google sign-in links the invitation to their account, and
someone with no invitation sees a "not invited" page. Owners invite, change roles and remove people on the Members page
(`/members`, API `/api/v1/members`); the last owner cannot be removed or demoted.

- The first owners are created with `node db/bootstrap-owners.mjs a@example.com b@example.com --yes` (without `--yes` it
  only shows what it would do). It is safe to run again.
- How a request is let in, in order: a Bearer `DEV_TOKEN`, then a sign-in session, then `OPEN_EDITING=true`, then (when
  sign-in is on) `PUBLIC_VIEW=true` for reads as the read-only viewer, otherwise a 401 so the app shows the sign-in page.
  To make editing invite-only while keeping the demo viewable, set `OPEN_EDITING=false` in Vercel (leave `PUBLIC_VIEW` alone).
- Tests never talk to Google: `server/test-utils.ts` has a stand-in (`fakeAuth`), and `server/auth.real.test.ts` runs the
  real library against an in-memory Postgres. `npm run e2e` also runs the sign-in flow (`e2e/auth.mjs`).

## Landing page at the root

Visitors who open the bare address see `public/landing.html`: a static information page with **Sign in** (`/sign-in`, which opens
Google) and **Explore the read-only demo** (`/projects`). The build does this in `scripts/finish-build.mjs` (run by `npm run
build`): the app's own page becomes `dist/app.html` and the landing page becomes `dist/index.html`, and `vercel.json` sends every
other address to `app.html`. Vercel serves a real file before it applies routing rules, which is why a routing rule for `/` was not
used. A small script on the landing page calls `/api/v1/auth/get-session` and sends a signed-in person to `/projects`; the page is
hidden for that moment only when scripts run, and shown anyway if the check is slow or fails. In local development (`npm run dev`)
the app is at `/` and the landing page is at `/landing.html`. For the later production version with fuller marketing content,
edit `public/landing.html`, or move it to its own site and point the root at it.

## Public pages

`public/robots.txt` asks crawlers to stay out of the app and the API and leaves the information pages open. It is a request, not access control.

`public/privacy.html` (served at `/privacy`) and `public/about.html` (at `/about`) are plain HTML, not part of the React app, so a crawler
such as Google's sign-in verification can read them without running scripts. Google's Branding settings use them: the home
page is `/about` and the privacy policy is `/privacy`. The policy states what the app collects and why, so update it
whenever that changes (for example when a live AI provider is added). The two short notice paragraphs in it also appear in
`src/shell/privacy.ts` (the footer), so change both together.

## AI analysis (groundwork, not switched on)

`server/ai-analysis.ts` is the model-backed analysis, written and tested without any model. It builds the prompt (speakers become
ids P1/M1; emails, phone numbers and names are masked), checks the reply against a schema (one retry with the error message), and
keeps a quote only if it is a verbatim part of a participant's line; participant and mention counts are derived from the surviving
quotes. It returns what the simulated `analyze` returns, so saving and the screens do not change. It takes an injected `ModelCall`;
slice E2 supplies the one that reaches Anthropic. `server/ai-analysis.test.ts` has unit tests, golden tests on the three demo
projects (recorded replies in `server/fixtures/analysis`, rewritten from the demo data by `npm run ai:fixtures` until real
recordings replace them), and a run that saves a model-shaped analysis. Nothing calls out or costs anything.

## Cost limits

Neon Free and Vercel Hobby stop at their limits instead of billing. When the database is paused the API returns
`503 db_unavailable` and the app shows a message. Do not add pings or cron jobs that query the database.
