# Signal Flow: instructions for Claude Code

A research-to-requirements app (React + Carbon + a Hono API + Postgres). `README.md` has the layout, commands, environment variables
and sign-in model. `docs/RUNBOOK.md` is how to operate it; `docs/SETUP.md` is how to stand it up in a new environment. This file is
the working agreement: what to run, what never to do, and the traps that have already cost time.

## Before you call something done

    npm run check:all     # typecheck, API + database tests, design-system rules, token registry
    npm run e2e           # browser tests on an in-memory API (needs Chrome; CHROME_PATH to point at another)

CI (`.github/workflows/ci.yml`) runs the same on every push and pull request. Check an exit status explicitly: `tail` hides it.
After a push, confirm `GET /api/v1/health` reports `version` equal to the short commit SHA before saying it is live.

## The design system is enforced, not advisory

- `npm run validate:pages` runs the design-system rules over `src/`. No raw hex, `rgb()`, inline `style`, raw `px` (only `0` and
  `1px`), `<button>`, `<input>`, `<select>`, `<table>`; only components in `vendor/design-rules/components.json` (Tabs, tables and Switch are allowed: use the library's, never a raw `<table>`).
- Colors and type live only in `src/theme.scss` and `src/tokens.scss`. Everything else uses `var(--at-*)` and the `role()` mixin.
  `npm run check:tokens` keeps the registry (`vendor/design-rules/tokens.json`) in step with `theme.scss`: change both together. It also fails on a token defined twice, `npm run check:contrast` checks the readable pairs in the registry, and the linter refuses hand-set `font-size`, `line-height`, `letter-spacing`, `font-family`, numeric `z-index`, an icon-only `Button` with no `iconDescription`, and namespace or default imports of `@carbon/react`. If nothing fits, add a type role or a layer token upstream; never override in a page. Which design system governs the app is `vendor/design-rules/profile.json` (company-owned, synced); `design-rules.config.json` is this app's own list of components it chooses not to use, with reasons.
- `vendor/design-rules/` is a pinned copy from the design-system-mcp repo. Never edit it; change the rule upstream and run
  `npm run rules:sync`.

## API and types

`openapi/openapi.yaml` is written first and the tests check every route against it. After editing it run `npm run gen:api`;
`npm run check:api-types` fails if `src/api/schema.d.ts` is stale. Writes need an owner or editor; reads work as the read-only viewer.

## Teams

A team owns projects; a person has a role per team (`core.team_memberships`); workspace owners are leaders who see every team, read-only in teams
they are not in; the read-only demo viewer sees everything. Rules live in `server/teams.ts` and are enforced in the API, never only in screens:

- Any route that names a project, directly or through a theme, document, story or agent step, must start with `/projects/{id}`, `/themes/{id}`,
  `/specs/{id}`, `/stories/{id}` or `/agent-steps/{id}`: `withContext`/`withReadContext` then answer 404 to a caller outside the team and 403 to a
  write by someone who may only read. A route about something else goes in `NOT_ONE_PROJECT` in `server/teams.test.ts` with its reason. That test walks
  the API spec, so a forgotten route fails the build.
- A list or rollup of projects takes the caller's visible teams (`visibleTeamIds(ctx)`): `listProjects`, `listSpecs`, and every Platform Insights
  reader (`currentThemes(visible)`). Code that WRITES platform data keeps reading `CURRENT_THEMES` (all teams), or it would treat another team's themes as gone.
- `ctx.role` is the role for everything that is not about one project (owner = leader). A project's own role is `projectAccess()`.
- With `SSO_TEAM_GROUP_PREFIX` set, sign-in groups decide people's places in every team but the default (`server/team-groups.ts`, run from `memberFor`); the Teams page then refuses to edit those people.
- Migration 0036's triggers keep the default team in step with workspace memberships and new projects, so the previous code still works during a deploy.

## Workspaces (tenancy)

Each customer is a workspace; nothing is shared between them. Two locks, both tested in `server/tenancy.test.ts`:

- **The API checks** (team and project rules, `viewerOf` for launches) are the first lock, as before.
- **Row-level security** (migration 0047) is the second: every query a signed-in request makes runs as the restricted role `sf_app` with `app.workspace_id` set, in its own small transaction, so the database refuses another workspace's rows even if application code is wrong. In a handler, `getDb()` is always one workspace's view (it throws outside a request's workspace). `platformDb()` is the owner role that row-level security does not restrict: use it only for paths that act for no workspace (finding who the caller is, the scheduler, Slack's inbound calls, the unsubscribe link), and say why in a comment. Do not add to that list lightly.
- A new table with workspace data needs `workspace_id`, row-level security and the `workspace_isolation` policy (copy 0047's loop); a table that belongs to a person or to Slack goes in `NOT_IN_ONE_WORKSPACE` in the tenancy test with its reason. The test fails otherwise. A child table gets its workspace id from its parent with the `fill_workspace` trigger (migration 0046), so older code that omits it still works during a deploy.
- People are global (one person, several workspaces). A workspace sees only its own members; find or create a person by email with `core.user_id_for_email(...)`, never by reading `core.users` directly.
- Which workspace a request is for: `server/workspace-host.ts` (the subdomain under `WORKSPACE_BASE_DOMAIN`, else `WORKSPACE_SLUG`). Being signed in to one workspace never gets you into another.
- Connections are per workspace: Slack and Jira come from `core.workspace_integrations` (token encrypted with `SETTINGS_ENCRYPTION_KEY`, set with `node db/set-integration.mjs`), read through `integrationsFor` in `server/workspace-settings.ts`. The deployment's own `SLACK_BOT_TOKEN` and `JIRA_*` belong to its home workspace only (`WORKSPACE_SLUG`); any other workspace has no connection until it has its own row. Never read `env.SLACK_*` or `env.JIRA_*` in a handler: ask `integrations(workspaceId)`.
- Plans (`core.plans`, set with `node db/set-plan.mjs`): a workspace's AI cap is its own setting, else its plan's, else `AI_MONTHLY_BUDGET_USD` (`workspaceBudget` in `server/ai.ts`); `AI_PLATFORM_MONTHLY_USD` caps all workspaces together; a plan's `seats` limit refuses an invitation with 409 `seat_limit`. The restricted role may only read plans and workspaces.
- Not yet per workspace: company sign-in settings (`OIDC_*`, `SSO_*`), Slack's inbound calls (one signing secret, so the home Slack app), and a master usage view across workspaces.

## Security baseline

- **Headers.** `vercel.json` sets the content security policy and the other security headers on every page and answer; the API adds `nosniff` and a referrer policy itself. The policy allows only this site (no external scripts, fonts, images from other places except `https:` images such as profile pictures) and exactly one inline script, the landing page's, by hash. If `public/landing.html`'s inline script changes, `scripts/headers.test.mjs` fails: put the new hash in `vercel.json`. Do not add `'unsafe-inline'` to `script-src`; add a hash or move the script to a file. Do not load anything from another site without adding it to the policy on purpose.
- **Rate limits.** Costly routes (AI work, PDF exports, thumbnail captures, invitations, Slack codes, Jira tickets) carry `limited(kind, perMinute)` after their context middleware (counted per person in `core.rate_limits`; answers 429 `rate_limited` with `Retry-After`; a counting failure lets the request through). A new route that spends money or starts a slow job gets one.
- **Errors and logs.** An unexpected error answers a plain 500 and logs only its name, code and a short message, never a database detail (it can carry a typed value). Log names and messages, never request bodies, tokens, emails or transcript text.
- **Audit.** A PDF export is recorded (`exported`, with the document and who). New actions that take data out of Signal Flow, or change who may see it, get an audit row.

## Launch

Launch (release readiness) is built in slices; the plan is the "Launch: build plan" doc. Rules so far:

- A step with no reviewer is a **gap**, never hidden. "Not used" is a separate, explicit team setting (`core.team_launch_steps`). Never make a step disappear because nobody covers it.
- Who covers a step comes from one function, `reviewersFor`/`coverageState` in `shared/launch.mjs`. Do not re-derive it in a screen or a query. Screens and messages say approver and backup (never reviewer or alternate); only code names and URLs keep the old words.
- Approval authority comes from assignment in Signal Flow (members and teams), never from Slack membership. Slack carries conversation; Signal Flow keeps decisions.
- An external member (`is_external`) is a viewer, covers named teams only, and is refused in the API everywhere except the routes made for them (`EXTERNAL_MAY_CALL` in `server/app.ts`). Add a route to that list only when it is meant for them.
- One launch per project. Launch answers are append-only; a brief change reopens them (the answer keeps the `brief_key` it was given on; never overwrite or delete an answer).
- Who may see or change a launch is `viewerOf` in `server/launches.ts`, not the team check: `/launches/{id}` routes are in `NOT_ONE_PROJECT` for that reason and answer 404 to anyone it does not cover. `EXTERNAL_MAY_CALL` allows `/me` and `/launches...` only.
- Every launch email goes through `deliver` in `server/launch-notices.ts`, the one place the temporary recipient limit and the placeholder-address rule are applied (a message they exclude is stored as `held`, never dropped). A new launch message is a new `kind` and dedupe key there, never a direct `mailer.send`. A failed send must not fail the action that caused it.
- Slack posts go through `reply`/`startThread` in `server/launch-slack.ts` (one thread per launch, each event once by dedupe key). A failed post must not fail the action behind it; user text goes through `slackText`; nothing is read back from Slack and approval authority never comes from it. `REMINDERS_ONLY_FOR` does not limit channel posts.
- Reviewers are kept informed automatically (`server/launch-updates.ts`: storyboard written, requirements published, answers asked for), for awareness only; there is no follower or digest feature. A message about a document links to the launch's Product Brief tab (`?tab=brief`), whose Docs panel opens the PDF; an external reviewer never gets the storyboard. A reviewer marked away needs an alternate for every step (409 `no_alternate`); the alternates are emailed through the same send point.
- A launch export (`server/launch-export.ts`) builds a self-contained, escaped page and never fetches anything; an external reviewer cannot export; `launchForSystem` leaves the brief out unless asked (`withBrief`), so a reader that needs the brief must ask.
- Anything done from Slack runs the same function as the screen, as the member the Slack user is linked to (`contextForUser`): never re-implement a rule for Slack. A Slack request is acted on only after `verifySlackSignature` and `rememberRequest` (see `fromSlack` in `server/app.ts`); a Slack identity comes only from a one-time code, never from a name or email on the Slack account.
- Do not start a `data-testid` with `story-` for anything but a story card: the project tour points at `[data-testid^="story-"]`.

## Vocabulary

The words people read for the sign-off roles (approver, backup, approvals) live in ONE place, `shared/terms.mjs` (`T.approver`, `T.Approver`, `T.a('approver')`, ...). Terminology changes with customer feedback and the market, so no sentence, label, email, Slack post, PDF or error message hard-codes them: write `${T.approver}` (and `T.a(...)` for the article, so "an approver" becomes "a reviewer" correctly). `scripts/terms.test.mjs` fails on a hard-coded one; put `terms:ignore` on the line before it only when the word is stored data (an audit-log verb: history is not re-worded). What does NOT change with the wording, on purpose: tables, API paths and fields (`/approvals`, `approver`, `backup`), error codes, and the names inside the code. To rename: edit `DEFAULTS` in `shared/terms.mjs`, run `npm run check:all`, then update the browser tests (`e2e/` assert the shipped words) and the docs; the nouns are covered, the verbs around them ("approves", "Approved by") are plain English to edit in place. A per-customer vocabulary is `makeTerms({...})`; wiring it to `brand/brand.json` is the next step if a customer needs their own.

## Database

- A migration is `db/migrations/NNNN_name.sql` plus `NNNN_name.down.sql`. Never edit one that has been applied anywhere.
- **Write migrations the previous code can run against.** The old deployment serves until the new one is ready, so add in one
  release and remove or rename in a later one.
- A production build applies pending migrations (`db/deploy-migrate.mjs`). It refuses `drop table|column|schema|type`, `truncate`
  and `delete from` unless the file has the line `-- migrate: allow-destructive`; add that only after a person has reviewed it.
- Applying to production by hand (`node db/migrate.mjs up --yes`) needs the person's explicit yes in the chat first.
- Update the table counts in `db/test.mjs` when a migration adds or removes a table.

## Sign-in

Better Auth in `server/auth.ts`; the company provider (`OIDC_*`) is the social provider `oidc`, Google is `google`. Roles come from an
invitation, or from sign-in groups (`SSO_*_GROUPS`, `server/sso.ts`, applied in `server/context.ts`). `server/auth.oidc.test.ts` runs the
real library against a stand-in provider: extend it when sign-in changes. Never trust an ID token without the library's verification.

## AI

Every model call goes through the provider seam in `server/ai.ts`. Call the model **before** opening a database transaction, never
inside one. Model output is schema-checked and grounded (quotes verbatim, figures from the supplied numbers) before it is saved.
Where a call runs is the provider's `inference_geo`: set `AI_INFERENCE_GEO=us` to ask for US-only (billed at 1.1 times, already in `costUsd`), and the place each call ran is kept in `core.ai_usage.inference_geo`. The data location statement for customers depends on it. Spend is capped by `AI_MONTHLY_BUDGET_USD`; `AI_ENABLED=false` returns everything to the simulation. If what is sent to a provider
changes, update `public/privacy.html` and the landing text in the same change.

## Browser-test traps (e2e/)

- Hidden Carbon dialogs keep their buttons in the DOM: click inside `.cds--modal.is-visible`, and wait about 300 ms after one closes.
- The fixed header can cover a scrolled-to button. Icon-only Carbon buttons have no `aria-label` attribute: use `data-testid`.
- Headings styled `text-transform: uppercase` read as capitals in `innerText`: match case-insensitively.
- The theme list deliberately does not repeat project names, quotes or requirement lists.
- On CI, Chrome needs `--no-sandbox` (the tests add it when `CI` is set).

## React trap

State that starts from a prop (`useState(prop)`) does not follow the prop. Initialise from the data that is already there, and key the
component by the thing it edits (`key={`${id}:${title}`}`), or the box opens empty when the data was loaded first.

## Never

- Commit secrets or `db/.env.local`, print a secret in chat, or put a company name, email or domain into code (use settings).
- Change the app name, logo, home page or privacy URLs that a Google OAuth consent screen was verified with, without expecting a
  re-review.
- Merge a platform theme, delete data, or run production migrations without the person asking for it.

## Working style

Small commits straight to `main` (solo project; every push deploys), each one passing the checks above. Say what was not tested.
Platform Insights, Stories and the Design step have long histories in the plan docs; read the README section for the area first.
