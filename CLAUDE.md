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
Spend is capped by `AI_MONTHLY_BUDGET_USD`; `AI_ENABLED=false` returns everything to the simulation. If what is sent to a provider
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
