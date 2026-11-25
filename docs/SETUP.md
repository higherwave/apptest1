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
| Identity provider | Your company sign-in over OpenID Connect, or Google (step 7) |
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
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (or `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | From step 7 |

A **production build applies pending migrations** as its last step (`db/deploy-migrate.mjs`), so later migrations deploy with the code.
On a host other than Vercel, set `MIGRATE_ON_DEPLOY=true` where the production build runs, and run `npm run build` there.
Add your domain and its DNS record in the host.

## 7. Sign-in

Use your company's identity provider, over OpenID Connect (Okta, Entra ID, Keycloak, Auth0, Google Workspace). Ask the identity team
to register an application of type **web, authorization code with PKCE**, with:

- Redirect (callback) address: `<BETTER_AUTH_URL>/api/v1/auth/callback/oidc`
- Scopes: `openid`, `profile`, `email` (and `groups`, on Okta, if roles come from groups)
- The issuer address (for example `https://acme.okta.com`, or Entra's `https://login.microsoftonline.com/<tenant>/v2.0`), a client id and a client secret

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and, for the button text, `OIDC_NAME` (step 6 lists the rest). Entra ID: add the
optional `email` claim to the ID token, and send groups as group ids or names in the `groups` claim. A deployment with `OIDC_ISSUER` set starts
**closed**: nobody reaches data without signing in.

Who gets in, in order of how much the identity provider decides:

1. **Invitation only (default).** Owners invite people on the People page (Settings > User Access > People); the provider only proves who they are.
2. **Anyone at the company.** `SSO_DEFAULT_ROLE=viewer` adds each signed-in person as a viewer the first time. Owners promote people on the People page (Settings > User Access > People). If Google sign-in is also on, add `SSO_ALLOWED_DOMAINS=acme.com` so only company addresses are added; without it nobody is (any Gmail account would otherwise qualify).
3. **Groups decide.** Set `SSO_OWNER_GROUPS`, `SSO_EDITOR_GROUPS`, `SSO_VIEWER_GROUPS`. Roles follow the groups at every sign-in; remove someone from a group
   and their role goes at their next sign-in (end a session now by removing them from the company directory, which stops new sign-ins). Put the people who
   run the workspace in the owner group **before** switching this on.

To try a provider on your own machine before deploying, with a throwaway database, see [SSO-TRY.md](SSO-TRY.md) (`npm run sso:try`).

Offboarding is the provider's job: a person it no longer signs in cannot start a session. An existing session lasts up to seven days; removing a member
on the People page (Settings > User Access > People) (modes 1 and 2) ends theirs at once.

Google still works beside it (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect `<BETTER_AUTH_URL>/api/v1/auth/callback/google`); use one provider
per company unless you know why you want both, because the same person signing in two ways is two accounts.

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

## 11. Customer addresses on your own domain (several customers on one deployment)

One deployment can serve many customers, each at its own address, `<customer>.<your domain>`, with one sign-in shared by all of them. The address chooses the workspace; being signed in never lets a person into a workspace they were not invited to.

1. **The domain, on Vercel.** Add the domain and its wildcard (`example.org` and `*.example.org`) to the Vercel project. A wildcard needs the domain's DNS to be served by Vercel, so point the domain's nameservers at the ones Vercel shows. Use a domain that holds nothing else.
2. **Settings** (Vercel, Production):
   - `WORKSPACE_BASE_DOMAIN=example.org`
   - `BETTER_AUTH_URL=https://app.example.org`: the one fixed sign-in address. People start on their customer address, go through this one and the identity provider, and come back to where they started.
   - `WORKSPACE_SLUG` stays the name of the deployment's own (home) workspace, which is what `app.example.org` itself shows.
3. **Google.** Add `https://app.example.org/api/v1/auth/callback/google` as an authorized redirect URI (keep the old one while people move over), and add `example.org` as an authorized domain on the consent screen. A new home page or privacy address on the consent screen can trigger a re-review by Google: do that change on purpose, not by surprise.
4. **A customer.** `node db/init-workspace.mjs --name "Acme" --slug acme --owners a@acme.com` (names such as `app`, `www`, `api` and `login` are refused), then `node db/set-plan.mjs --workspace acme --plan pilot`, and its own Slack and Jira with `node db/set-integration.mjs`. Acme's address is `acme.example.org` from that moment.
5. **What changes for people already signed in.** Their old session belongs to the old address only. They sign in once more; after that one session works on every address they belong to.
6. **Try it before a customer does** (nothing replaces a real browser here): sign in at `acme.example.org` and land back there; open `beta.example.org` with the same session and expect "not invited"; sign out at one and expect to be signed out at the other; open a sign-in link whose return address is another domain and expect it to be refused.

Security notes: one session works on every customer address, so any address under the domain that could be taken over or show someone else's content would expose it. Only the platform creates addresses, nothing else is hosted under the domain, and the platform's own names are reserved in code and in the database. A return address or origin outside the domain is refused.

## 12. Pulse: feedback channels and Salesforce (optional, owners' preview)

Pulse reads only what an owner designates. Both connections are per workspace and read only.

**Slack channels (Pulse reads them hourly).**
1. Open the Signal Flow app at api.slack.com/apps, then OAuth & Permissions, Bot Token Scopes. Add `channels:history` (the other scopes are already there). For private channels also add `groups:read` and `groups:history`. Or paste the updated `docs/slack-app-manifest.json` (replace `APP_URL`).
2. Reinstall the app to the Slack workspace and approve. The bot token (`xoxb-...`) stays the same; it already lives in Vercel as `SLACK_BOT_TOKEN` (or, for a customer, in `node db/set-integration.mjs --kind slack`).
3. In Slack, invite the bot to each feedback channel: type `/invite @Signal Flow` in the channel. A bot reads only channels it is in.
4. In Signal Flow, Settings, Pulse, "Where Pulse listens": enter the channel name, choose what it counts as and "Wait for review" (safe default) or "Count at once", then **Add channel** and **Check now**.

**Salesforce (read only, for ARR).**
1. In Salesforce Setup, create a Permission Set that gives read on the Account object and read on the ARR field, and a dedicated integration user (a "run-as" user) with it. Nothing more: that user's access is the real limit on what Pulse can see.
2. Setup, App Manager (or External Client App Manager), create an External Client App with OAuth enabled and the scope "Manage user data via APIs (api)". Under the OAuth policies enable the Client Credentials Flow and set the run-as user from step 1. Copy its Consumer Key and Consumer Secret.
3. Note the ARR field's API name on Account (a custom field ends in `__c`, for example `ARR__c`) and the org's address (`https://yourcompany.my.salesforce.com`).
4. Connect it (a dry run first, then add `--yes`): `SF_SECRET='<consumer secret>' node db/set-integration.mjs --workspace <slug> --kind salesforce --secret-env SF_SECRET --site https://yourcompany.my.salesforce.com --client-id <consumer key> --arr-field ARR__c`. The secret is read from the environment variable, encrypted with `SETTINGS_ENCRYPTION_KEY`, and never printed.
4b. For opportunity notes, the run-as user's permission set also needs read on the Opportunity object and on each field you will name (for example Next Step, Description, a custom Loss Reason field), and on the opportunity Amount, Stage, Close Date and the Account relationship. Nothing is written.
5. In Signal Flow, Settings, Pulse, "Salesforce, for ARR": **Copy accounts now**. Topics then show an ARR column, the impact map gets an Accounts / ARR switch, and a topic's page lists each account's ARR. A signal's account must match the Salesforce account name (capitals, punctuation and "Inc"/"LLC" are ignored).
6. Then, still in Settings, Pulse, "Salesforce opportunity notes": enter the fields by their API names, choose which opportunities (open, lost in the last 90 days, or both) and keep "Wait for review" until you have seen what the notes contain. Press **Add opportunity notes**, then **Check now** under "Where Pulse listens". Topics then show an **In play** column, and **Rank by** can order them by it.

**HubSpot support tickets (read only).** Pulse reads the subject, description and category of tickets, and the company each belongs to. It never reads agent notes, conversations or contact details, and never writes.
1. In HubSpot, make sure the account has tickets (Service, Tickets). A free account with the free Service Hub includes basic ticketing; check that a Tickets page appears and you can create a ticket by hand.
2. Create a **service key** (HubSpot closed the creation of legacy private apps on 26 October 2026, and recommends service keys for in-account integrations): Development, Keys, Service keys, **Create service key** (Settings, Integrations, Service Keys is the other route). You need to be a super admin, or have the Developer tools permission.
3. Name it (for example "Pulse read only") and add exactly these scopes, all read only: `crm.objects.tickets.read`, `crm.objects.deals.read`, `crm.objects.companies.read`, `crm.schemas.deals.read`, `crm.schemas.companies.read`. (Tickets and companies are used now; the deal scopes are for reading deals later.) Create it, then Show and Copy the key. Treat it like a password.
4. Optional: your HubSpot account number (the digits in the address after `/contacts/` when you are signed in). It only makes each ticket link back to HubSpot.
5. Connect it, in the app (no Terminal): Settings, Pulse, "HubSpot support tickets", paste the key into **HubSpot service key** (a password-style field), optionally the account number, and press **Connect HubSpot**. The app tries the key against HubSpot first (a wrong key or a missing permission is refused with a plain message and nothing is stored), then stores it encrypted with the deployment's `SETTINGS_ENCRYPTION_KEY`. It is never shown again; **Replace key** and **Disconnect** are on the same card. Connecting, replacing and disconnecting are in Settings, Audit log, under Apps and connections, without the key. (The command line still works for an operator: `HS_KEY='<the service key>' node db/set-integration.mjs --workspace <slug> --kind hubspot --secret-env HS_KEY --portal-id <digits> --yes`, which needs the same `SETTINGS_ENCRYPTION_KEY` the app has.)
6. Still on that card: **Test connection** (one tiny read; it says what is missing if the key is refused or lacks a scope), then **Read support tickets** (optionally only some ticket categories, written as they are in HubSpot). Tickets are read about once an hour, and with **Check now** under Where Pulse listens. The first read takes tickets changed in the last 90 days. Each ticket counts once, in the Support tickets channel (weight 0.8 until changed under Pulse, Weights).
7. Local demo without an account: `HUBSPOT_DEMO=true` on the in-memory server connects a stand-in HubSpot with Anchor CX support tickets (the `PULSE_SAMPLES=true` setup then reads them too).
