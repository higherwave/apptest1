# Setting this up in a new environment

For a company that wants its own copy: its own design system, its own accounts, no demo data. About two focused days, plus whatever
approvals your company needs. Everything here is a command in this repo; the parts only you can do (accounts, consoles) are marked
**You**. `docs/RUNBOOK.md` covers running it afterwards.

What is generic and what is yours: the **kit** is the design-system-mcp repo (MCP server, linter rules, token pattern) and this app's
code. Your **company layer** is a brand pack, a few accounts, an identity provider, an AI provider (optional) and your policy pages.

## 0. Before you start

- Node 22 and git. A GitHub organisation, a host (Vercel is assumed below), a Postgres database, and a person to approve each.
- Decide the workspace **name** and **slug** (lowercase, hyphens: `acme`), and the first two **owners'** email addresses.
- Check with security which data may reach an AI provider before turning AI on (step 8).

## 1. Accounts (You)

| Need | Notes |
| --- | --- |
| GitHub organisation | Two repos: the design-system kit and the app |
| Host | Vercel needs a paid plan for commercial use (Hobby is non-commercial). Other hosts work: the API is a standard fetch handler, see step 6 |
| Postgres | Neon through the Vercel integration is the tested path; any Postgres 15+ with a direct (unpooled) connection works |
| Identity provider | Google sign-in is built in (step 7). A Google Workspace "Internal" app needs no public verification |
| AI provider (optional) | Anthropic API key with a spend limit |

## 2. The design-system kit (the MCP server)

1. Fork or copy `design-system-mcp` into your organisation. In its `package.json`, set `repository` to your repo's URL: that is the one
   line `register_pattern` needs (or set `GITHUB_OWNER` and `GITHUB_REPO`).
2. Replace the brand data in `registry/`: `components.json` (the Carbon components you allow), `tokens.json`, and any `patterns/`.
   Keep `lib/validateRules.ts` (the rules) as is, or adjust it deliberately.
3. Deploy it as its own host project with `MCP_SHARED_TOKEN` (a long random string) and `GITHUB_TOKEN` (a fine-grained token limited to
   that one repo, contents and pull requests: write).
4. **You**, on each developer machine, add it to Claude Code (check `claude mcp add --help` for the current syntax), for example:
   `claude mcp add --transport http design-system https://<your-mcp-host>/api/mcp --header "Authorization: Bearer <token>"`.

## 3. The app

    git clone <the app repo> acme-flow && cd acme-flow     # or "Use this template" if it is marked as one
    npm ci && npm --prefix db ci
    npm run check:all                                       # should pass before you change anything

Point the app at your kit and take its rules:

    npm run rules:sync -- --repo <your-org>/design-system-mcp --ref main
    git add -A && git commit -m "Pin our design rules"

## 4. The brand

    npm run brand:export -- ../acme-brand       # starts from the current brand
    # edit in ../acme-brand:  brand.json (names, contact), theme.scss + tokens.scss (colours, type), DESIGN.md, assets/ (logo, icons)
    npm run brand:apply -- ../acme-brand        # shows what would change
    npm run brand:apply -- ../acme-brand --yes

Copy `../acme-brand/registry-tokens.json` to the kit as `registry/tokens.json`, run `npm run rules:sync` again, then
`npm run check:all`: the token check fails if the registry and `theme.scss` disagree. Review `public/privacy.html`, `about.html`
and `landing.html` (they take names from `brand.json`, but the wording is the current company's) and `src/shell/privacy.ts`.

## 5. The database and workspace

Put the connection strings in `db/.env.local` (gitignored; never commit or paste them):

    DATABASE_URL_UNPOOLED=postgres://...
    DATABASE_URL=postgres://...

    npm run bootstrap -- --name "Acme Research" --slug acme --owners pat@acme.com,lee@acme.com          # shows the plan
    npm run bootstrap -- --name "Acme Research" --slug acme --owners pat@acme.com,lee@acme.com --yes    # does it

That applies every migration, creates the workspace and its four study templates, and invites the owners. No demo data. (The demo
story is optional and separate: `db/seed/`.)

## 6. The host

Import the app repo. Environment variables (Production), names only; values come from the consoles:

| Name | Value |
| --- | --- |
| `WORKSPACE_SLUG` | `acme` (the slug from step 5) |
| `OPEN_EDITING`, `PUBLIC_VIEW` | `false`, `false` for a company deployment |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | From the database (the Neon integration adds them) |
| `BETTER_AUTH_URL` | The address the app is served from, `https://flow.acme.com` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (32+ characters; changing it signs everyone out) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From step 7 |

A **production build applies pending migrations** as its last step (`db/deploy-migrate.mjs`), so later migrations deploy with the code.
On a host other than Vercel, set `MIGRATE_ON_DEPLOY=true` where the production build runs, and run `npm run build` there.
Add your domain and its DNS record in the host.

## 7. Sign-in

Create an OAuth client (Web application) in Google Cloud for your organisation. Authorised redirect URI:
`<BETTER_AUTH_URL>/api/v1/auth/callback/google`. Scopes are only `openid`, `email` and `profile`. For a Google Workspace
organisation set the consent screen to **Internal**. Only invited people can enter: owners invite on the Members page. Another
identity provider (Okta, Entra) is a change to `server/auth.ts` (the library, Better Auth, supports them); it is not wired up yet.

## 8. AI (optional)

Leave it off until security agrees what may be sent (`public/privacy.html` says what is). Then set `AI_PROVIDER=anthropic`,
`ANTHROPIC_API_KEY` and `AI_MONTHLY_BUDGET_USD` (also set a spend limit in the provider's console). `AI_ENABLED=false` turns it off
again at any time. The provider sits behind one interface in `server/ai.ts`; another provider is one more file.

## 9. Check it

    npm run doctor -- --db      # what is set, what is missing, with the fix for each
    npm run check:all           # types, tests, design rules, token registry
    npm run e2e                 # browser tests (needs Chrome)

Turn on the CI workflow (`.github/workflows/ci.yml`; no secrets needed), push to `main`, and sign in with an owner's address.

## 10. Hand over

Keep `CLAUDE.md` (how Claude Code should work in this repo) and `docs/RUNBOOK.md` current: they are the memory of how this is run.
