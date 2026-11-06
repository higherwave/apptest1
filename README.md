# Signal Flow

A research-to-requirements workspace: plan a study, analyse transcripts into themes, write a reviewed
requirements document, and track the resulting stories on a board. Built from the Signal Flow prototype
(Claude Design), with React + Carbon + the Airtable style layer, a small API, and Postgres on Neon.

The earlier Whirl pilot app lives at the git tag `archive/old-react-test`.

**Running this for a company of your own?** Start at `docs/SETUP.md`. Day-to-day operation is in `docs/RUNBOOK.md`; how Claude Code
should work here is in `CLAUDE.md`.

## Layout

| Path | What |
| --- | --- |
| `src/` | React app (Vite). `theme.scss` and `tokens.scss` are the only files that define colours and type; everything else uses `var(--at-*)` and the `role()` mixin |
| `server/` | The API (Hono): `app.ts` routes, `context.ts` request context, `db.ts` Postgres access, tests beside them |
| `api/index.ts` | Vercel function entry; `vercel.json` rewrites `/api/*` to it |
| `openapi/openapi.yaml` | The API contract. Written first; tests check the routes against it |
| `db/` | Migrations, demo seed and their tests (see `db/README.md`) |
| `scripts/validate-pages.mjs` | Runs the design-system rules over `src/`, from the pinned copy in `vendor/design-rules/` (no other checkout needed) |
| `brand/brand.json` | The app, company and contact names, `galleryUrl` and `decisionGuidesUrl` (where the menu's Prototype gallery and Decision Guides links open, in other tabs, the guides link under the gallery; leave one out and its link is not shown). The only place a company name is written: the React app imports it, and the static pages in `public/` have `{{appName}}`-style placeholders filled in by the dev server and the build |
| `docs/` | `SETUP.md` (new environment), `RUNBOOK.md` (operating it) |
| `vendor/design-rules/` | A pinned copy of the validator and component allowlist from the design-system-mcp repo, with `SOURCE.json` recording where it came from and a hash of each file. Never edit by hand |

## Commands

    npm run dev          # React app on :5173 (proxies /api to :8787)
    npm run dev:api      # API on :8787; uses db/.env.local when present
    npm test             # API tests + database tests, all on an in-memory Postgres (no Neon compute)
    npm run validate:pages   # design-system rules over src/ (uses vendor/design-rules; MCP_REPO=/path tries a checkout instead)
    npm run rules:sync       # refresh vendor/design-rules from ../design-system-mcp, or from GitHub when it is not checked out
    npm run rules:check      # is the pinned copy behind upstream? (exits 1 if so)
    npm run check:tokens     # the token registry matches src/theme.scss
    npm run doctor [-- --db] # what is set and what is missing in this environment, with the fix for each
    npm run bootstrap -- --name "Acme" --slug acme --owners a@acme.com --yes   # migrations + workspace + first owners, no demo data
    npm run brand:export -- <dir> / brand:apply -- <dir> [--yes]               # move a brand pack (names, colours, logo) in or out
    npm run check:all    # typecheck + tests + page validation

## Migrations on deploy

`npm run build` ends with `node db/deploy-migrate.mjs`: on a **production** build (`VERCEL_ENV=production`) it applies any pending
migrations to the database, after the app has built and before the deployment takes traffic. A failed build changes nothing; a failed
migration is rolled back, fails the build, and leaves the previous deployment serving. Previews and local builds skip it.

- It refuses a pending migration containing `drop table`, `drop column`, `drop schema`, `drop type`, `truncate` or `delete from`
  (build fails and names the statement) unless the file has the line `-- migrate: allow-destructive`. An empty database (a new
  environment) is never blocked.
- `MIGRATE_ON_DEPLOY=true` runs it on any build (for another CI or host); `MIGRATE_ON_DEPLOY=false` turns it off. Without a
  database variable a production build fails rather than deploying without its schema.
- Write migrations so the **previous** code still works against the new schema (add, do not remove or rename in one step), because
  the old deployment serves until the new one is ready. Remove things in a later release.
- The manual command is unchanged: `node db/migrate.mjs up --yes` (status and dry run without `--yes`).

## Environment variables (Vercel)

The Neon integration adds the database variables (with a custom prefix; the code finds them by suffix).

| Name | Purpose |
| --- | --- |
| `DEV_TOKEN` | Until sign-in exists, data routes require `Authorization: Bearer <DEV_TOKEN>`. If it is unset on a production deployment they are refused (`auth_not_configured`). `/api/v1/health` is always open and never touches the database |
| `OPEN_EDITING` | On by default in the Vercel entry (`api/index.ts`) until you turn it off: a request with no token acts as the demo owner and can edit and delete anything (a wrong token is still refused). Set it to `false` in Vercel to require an invitation to edit; with `PUBLIC_VIEW` on (the default), a visitor who is not signed in can still look around, read-only. Local runs and tests are closed unless they set it to `true`. Turn it off before real data or a live AI provider is added, because anyone with the link could then start runs and change data |
| `PUBLIC_VIEW` | On by default in the Vercel entry. With sign-in configured and editing closed, a visitor with no session can read (GET and HEAD) as the read-only demo viewer, so a demo link works without a login. Set it to `false` to require sign-in even to look. With sign-in on, the API tells the CDN not to cache anything, because the CDN's cache is not keyed by cookie |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth client (Web application) for sign-in. Its authorized redirect URIs are `<BETTER_AUTH_URL>/api/v1/auth/callback/google` for each address the app is served from, for example `https://apptest1-eta.vercel.app/api/v1/auth/callback/google` and `http://localhost:5198/api/v1/auth/callback/google`. Mark the secret Sensitive in Vercel and keep a copy in a password manager |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Your company's identity provider over OpenID Connect (Okta, Entra ID, Keycloak, Auth0, Google Workspace and so on). `OIDC_ISSUER` is its issuer address, for example `https://acme.okta.com` (the app reads `<issuer>/.well-known/openid-configuration`). The redirect address to register there is `<BETTER_AUTH_URL>/api/v1/auth/callback/oidc`. The ID token's signature, issuer, audience and nonce are always checked; a wrong issuer fails closed. Setting these also makes the Vercel entry start closed (no `OPEN_EDITING`/`PUBLIC_VIEW` demo defaults) |
| `OIDC_NAME` | The name on the sign-in button (`Continue with Okta`). Default "single sign-on" |
| `OIDC_SCOPES` | Optional, space or comma separated. Default `openid profile email`. Okta needs `groups` added to send groups |
| `OIDC_REQUIRE_VERIFIED_EMAIL` | Optional. By default only an explicit `email_verified: false` is refused, because some providers (Entra ID) never send the claim. Set `true` to require `email_verified: true` |
| `OIDC_GROUPS_CLAIM` | Where the groups are in the ID token. Default `groups`; dotted for nested claims, for example `realm_access.roles` |
| `SSO_OWNER_GROUPS`, `SSO_EDITOR_GROUPS`, `SSO_VIEWER_GROUPS` | Comma-separated group names that grant each role (the highest wins; names match without regard to case). When any is set, **the groups decide roles at every sign-in**: a person in none of them is refused (`not_in_group`) unless `SSO_DEFAULT_ROLE` is set, and the Members page becomes read-only. The only owner is never demoted this way. Put yourself in the owner group before turning this on |
| `SSO_ALLOWED_DOMAINS` | Comma-separated email domains (`acme.com, corp.acme.com`). While Google sign-in is on, `SSO_DEFAULT_ROLE` adds only people at these domains, because anyone can have a Google account. With only the company provider (`OIDC_*`) it is not needed. This is also the way to let a whole company in as viewers with Google alone |
| `SSO_DEFAULT_ROLE` | `viewer` or `editor` (never owner). With no group rules: a signed-in person nobody invited is added with this role instead of being refused. With group rules: the role for a person in no group |
| `BETTER_AUTH_URL` | The address the app is served from, for example `https://apptest1-eta.vercel.app`. Locally, `http://localhost:5198` in `db/.env.local` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional. Other addresses the app is served from, comma-separated, for example the old `vercel.app` address while moving to your own domain. `BETTER_AUTH_URL` is always trusted |
| `BETTER_AUTH_SECRET` | A random string of 32 or more characters that signs sign-in cookies (for example `openssl rand -base64 32`). Changing it signs everyone out. Sign-in is on only when these two and one provider's settings (`GOOGLE_*` or `OIDC_*`) are set |
| `DESIGN_CAPTURE` | Default on. Set `false` to switch off thumbnails taken from prototype links (the Design table then offers upload only). The server opens the link in headless Chromium on its own side (`server/capture.ts`); nothing goes to a third party. Only public web pages are captured: private, loopback and link-local addresses, odd ports and credentials in a link are refused, including on every redirect and page resource |
| `CHROME_PATH` | Where to find a Chrome or Chromium for thumbnails when not on Vercel (Vercel uses the Chromium inside `@sparticuz/chromium`; `vercel.json` gives that function 60 seconds and includes its files). A developer's own Chrome is fine |
| `DESIGN_CAPTURE_ALLOW_PRIVATE` | Tests only. `true` lets thumbnails visit this machine's own pages. Never set it on a deployment: `npm run doctor` warns |
| `WORKSPACE_SLUG` (older name `DEMO_WORKSPACE_SLUG`) | The workspace this deployment serves. Default `higherwave-demo`. Create your own with `npm run bootstrap` |
| `DEV_USER_EMAIL` | The identity used for the demo token and the read-only viewer. Default `david@demo.signalflow.example`; not needed when everyone signs in |

## Sign-in and roles

Sign-in is Google, your company's OpenID Connect provider, or both (the sign-in screen offers each), run by Better Auth inside the API (`server/auth.ts`, routes under `/api/v1/auth`), with its
tables in migration `0012_auth.sql`. Access is by invitation: a person is a `core.users` row (their email) with a
`core.memberships` row (owner, editor or viewer). Their first sign-in links the invitation to their account, and
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

## AI analysis (built, off until configured)

`server/ai-analysis.ts` is the model-backed analysis, written and tested without any model. It builds the prompt (speakers become
ids P1/M1; emails, phone numbers and names are masked), checks the reply against a schema (one retry with the error message), and
keeps a quote only if it is a verbatim part of a participant's line; participant and mention counts are derived from the surviving
quotes. It returns what the simulated `analyze` returns, so saving and the screens do not change. It takes an injected `ModelCall`;
slice E2 supplies the one that reaches Anthropic. `server/ai-analysis.test.ts` has unit tests, golden tests on the three demo
projects (recorded replies in `server/fixtures/analysis`, rewritten from the demo data by `npm run ai:fixtures` until real
recordings replace them), and a run that saves a model-shaped analysis. Nothing calls out or costs anything.

`server/anthropic.ts` is the live provider (Anthropic Messages API over plain `fetch`, no automatic retries). It is used only when
`AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are both set and `AI_ENABLED` is not `false`; otherwise the app stays simulated.
`AI_ANALYSIS_MODEL` (default `claude-sonnet-5-5`) and `AI_MONTHLY_BUDGET_USD` (default 10) are optional. Cost is computed from the
reply's token counts and recorded in `core.ai_usage`, including a paid call whose reply was unusable. Provider failures (out of
credit, rate limit, bad key, outage) become a 503 with a plain message and the run is marked failed; the current analysis is never
replaced. `server/anthropic.test.ts` uses a fake network. At the app budget or when the account is out of credit, analysis and
drafting carry on with the simulation (recorded on the run).

`DATABASE_SIZE_LIMIT_MB` (default 1024, the 1 GB per project of Neon's free plan; `0` or `none` for no limit) is optional: it is the limit the **Admin > System usage** tab measures the database's size against. Set it to your plan's limit.

Requirements drafting (`server/ai-drafting.ts`, prompt `spec-draft-v1`) drafts one step per call and returns the shape of one simulated
step. The reply must match a schema, cite only themes in the document, and use only participant and session counts the app supplied
(one retry, then a plain 503). The call is made before any transaction opens: approving or redoing drafts first, then locks, checks
and saves together, so a failed draft changes nothing. Creating a document that cannot be drafted removes it again. `AI_DRAFT_MODEL`
optionally picks another model for drafting.

Theme matching (`server/ai-matching.ts`, prompt `theme-match-v3`, model `claude-haiku-5-5`, `AI_MATCH_MODEL` to change it) runs after each
analysis. Only current themes that have no platform theme yet are sent (tags already given stay put, so the numbers do not shuffle and
each call stays small). The model puts each one under an existing platform theme or names a new one; matches below 0.6 confidence are
left unmatched, and a "new" title that is an existing platform theme attaches to it, so near-duplicates are not created. A new platform
theme is created with `needs_review` (migration 0020) and shows a "New, review" tag until an owner or editor clicks Mark as reviewed;
if the research behind an unreviewed one goes away, it goes too. Hand-made tags are never replaced. The call is made before the write
transaction opens. At the budget or credit ceiling the keyword matcher places what it knows and starts nothing new.

## Platform Themes: matching and merging

Migration 0021. A platform theme can be **renamed** (`PATCH /insights/themes/{id}`) or **merged** into another
(`POST /insights/themes/{id}/merge`: tags, recommendations and case studies move across, the old name becomes an *alias*, the merged
theme is deleted, and the audit log records it). Aliases are shown to the matcher ("also called"). Every model match stores its one-line
reason and confidence (`platform_theme_sources.reason`); the open theme shows a one-line summary under its title (matched by AI, how sure, in how many projects), and hovering it lists each project theme filed there with the model's reason. The API's `matches` keeps the detail.

**There is no duplicates panel and no "Tidy this theme" tool on the screen** (removed Nov 2). Instead, duplicates are handled on their own:
after an analysis that started new platform themes, `autoMergeDuplicates` (`server/platform-themes.ts`; prompt `theme-dedupe-v2`,
`server/ai-dedupe.ts`) asks the model which look-alikes say the same thing. A pair is merged without a person only when it is the same
category and either both sit in the same known experience category at 0.75 confidence or more, or the model is at 0.9 or more; everything else
(different categories never) is filed as a suggestion in `insights.merge_suggestions`. Migration 0028 `insights.merge_history` snapshots
every merge, by hand or automatic: the theme that was folded in, its names, project-theme tags, recommendation and case-study links.
**Recent merges** on the Platform Themes page lists them (`GET /insights/merges`), and **Undo** (`POST /insights/merges/{id}/undo`,
owners and editors) brings the theme back under its old id with everything as it was. Undo is refused (409) if its old title is now taken,
and a merge whose target theme has since been merged away or deleted leaves the list with it.

The overview ranks problems and needs (`priority.rank`, `priority.score`: 60% share of participants plus 40% share of projects, times
0.1 for worked up to 1.1 for needs attention, times 1.15 for an opportunity, and up to 10% more when the team heard it too: 5% for each team conversation it came up in, so confirmation adds some weight but never makes a theme rank; delights are not ranked, and a theme only the team raised is never ranked). The **Suggested priority** order
sorts by it. `server/ai-rationale.ts` (prompt `rank-rationale-v1`) writes one or two sentences for each of the top eight
(`POST /insights/roadmap/rationale`); every "N of M participants/projects" it writes must be a figure it was given, and without a model a
plain template from the same figures is used.

## Experience categories

One shared list per workspace of what research is about (Scheduling, Reminders, Account setup): `insights.feature_areas`, API under `/api/v1/areas`,
page under the **Admin** tab (called Settings until 2026-11-05; its addresses are still `/settings/...`) at `/settings/categories` (`/settings/areas` and `/insights/areas` redirect there). Admin is the page title, with a row of tabs under it like Platform Insights: **Experience Categories** (with its own tabs, **Current Categories** and **Relevant Word Matches**, the suggested new categories), **AI usage and costs** (`/settings/status`, called App Status until 2026-11-05: AI mode, spend against the budget, recent problems), **System usage** (`/settings/usage`: how much of a limit the app has used; today the database's size against `DATABASE_SIZE_LIMIT_MB`, default 1024, 0 for none, read from the database itself through `GET /usage`, owners only, with the same 50% / 80% / 100% levels as the AI spend; nothing connects to Vercel, Neon or GitHub, so there are no access keys to keep, and more rows can be added in `server/usage.ts` when those accounts are on plans worth connecting), **Members** (`/settings/members`; `/members` redirects there) and the **Audit log** (`/settings/audit`: what changed and who changed it, newest first, filterable by people and roles, categories, projects, workflows and Jira hand-offs; it reads `core.audit_log` through `GET /audit`, owners only). Who sees what: viewers do not see Admin at all (its addresses send them to the projects); editors see Experience Categories only and may add and edit a category; owners see everything and alone merge and retire a category, see the member list, the audit log and system usage, and get the AI status details (the server enforces those four). The code and the API still say `area` (`insights.feature_areas`, `areaId`, `/areas`): only what people read says experience category. A question to ask or task to observe (`research.tasks.area_id`) and a test item (`research.test_items.area_id`) can name
one; follow-ups share their parent's. A category is a label, never a gate: nothing requires one, and a theme with none is matched freeform.

- **Who:** anyone reads the list; an owner or editor adds an area; only an owner renames, merges or retires one. Retired areas keep what uses them
  and are not offered for new choices; a merge moves everything over and keeps the old name as an alias.
- **Adding is typing.** In the Experience category box on a question or a theme, type a name and choose "Add ...": it joins the list for everyone. There is no dialog
  and no "New area" button; the Experience categories page has the same typing box. An area is optional everywhere: it helps the system file what people say, nothing depends on one.
- **Duplicates are avoided, not forced.** Names that look like an existing area are listed before the add option (`shared/areas.ts` decides: same words in any
  order, an alias or a common ending such as Schedule and Scheduling is the same; one name inside the other, or most words shared, is similar). The same name is never
  added twice (409 `duplicate_area` from the API, and the box offers the existing one); a look-alike the person chose to add anyway goes through (`force: true`). The
  same file suggests an area beside a question (`suggestAreas`), with no model call. Definitions and other names are added later by an owner (Edit on the page).
- **The analysis uses them** (prompt `analysis-v3`, migration 0026 `research.themes.area_id`): it is given the live areas (name, definition, other names) and the planned
  questions with their areas, and each theme names the one area it is about, or none. The name is kept only if it is a live area (by name or another name);
  anything else is no area. The simulation (no model) files a theme under the area whose words it shares most (`suggestAreas`). A person can correct a theme's
  area on the Themes page (`PUT /themes/{id}/area`). What is sent to the model changed, so `public/privacy.html` says so.
- **Matching prefers the same area** (prompt `theme-match-v3`): themes and platform themes are shown to the model with `[area: X]`; a match into a
  platform theme of a different known area stands only at 0.85 confidence or more (`applyAreaRule` in `server/ai-matching.ts`), otherwise the theme starts
  its own (model) or stays unplaced (keyword matcher). A platform theme's area is the most common area among the themes filed under it. Either side
  without an area is never held back. See "Platform Themes: matching and merging" for automatic merging and undo.
- **New areas are proposed** (`server/area-proposals.ts`, migration 0029, `GET /areas/proposals`): current themes with no area are grouped by the word their titles share. A
  group of at least two themes raised by at least three people that no live area covers (name, other names) becomes a "Suggested areas" card on the Experience categories page. **Add area**
  creates it and files those themes under it (`POST /areas/proposals/accept`); **Not now** (`/dismiss`) hides it for good, and a dismissed word keeps its themes so
  their other words do not come back as new suggestions. Words only, no model call, so nothing new is sent to a provider.
- **Rollups group by area** (Platform Themes): a **Group by** control (None, the default, or Experience category; `?group=area` in the address) divides the table into a section
  for each area, ordered by the current Order, with **Unassigned** last; sections collapse. A platform theme's area is the most common area among its project themes
  (`area` on `GET /insights/themes`). The table never rearranges areas: only a theme with no area gets an **Add to Experience Category** button in its open row, which opens a panel sliding in from the right (`AssignAreaPanel` on the shared `src/components/RightPanel.tsx`: search, or type a new name and choose Add; one tap files the theme and closes the panel). A filing a person made can be taken back: the open row says so and offers **Undo** (`DELETE /insights/themes/{id}/area`, from the audit log; an area the analysis chose is not undone here, 409 `not_filed_by_hand`)
  (`PUT /insights/themes/{id}/area`, 409 `already_assigned` otherwise), which files it and its project themes. Areas come from the analysis and matching.

## Spend alerts

`GET /ai/status` returns `spendLevel` (`ok`, `half` from 50%, `high` from 80%, `reached` at 100% of `AI_MONTHLY_BUDGET_USD`) and `month`
beside `budgetUsd` and `spentUsd`. Owners see spend this month and recent problems under Admin > AI usage and costs;
owners also get a banner above the app bar at each level. Dismissing it hides that level for the month in that browser
(`localStorage`); the next level brings it back.

## Cost limits

Neon Free and Vercel Hobby stop at their limits instead of billing. When the database is paused the API returns
`503 db_unavailable` and the app shows a message. Do not add pings or cron jobs that query the database.

## Right panel

A panel that slides in from the right edge and leaves the page visible keeps people in context. It is a design-system pattern (`signal-flow-right-panel` in the design-system-mcp registry, found with `search_patterns`): build it with `RightPanel`, a passive Carbon Modal laid out at the right edge. The linter rule `no-hand-rolled-side-panel` refuses a hand-positioned fixed element on that edge (vendor/design-rules, synced from the rules repo).

- Personas and Case studies share the Group by control (`GroupBy.tsx`, `?group=area`): the themes inside each open row are grouped by experience category.

**Storyboard (replaced the project Journey Map on 2026-11-06).** The project's research as six slides for product leaders: Title, The problem and what we did, What we heard, Recommended solutions, Trade-offs, Recommendation and the ask. It is **read-only**; people download it and change it in another tool. The facts (participants, sessions, roles, the test plan's tasks, the session dates, the strongest themes with a customer's words credited by role, never by name) are read live from the project (`gather` in `server/storyboard.ts`); what a model writes (the headline, the problem, one to three recommended solutions each citing the themes it answers, their benefit, cost, risk, what is given up and the alternatives, and the recommendation and ask) is a best guess, written once and saved in `research.storyboards` (migration 0034, one row per project) so everyone sees and downloads the same text. An owner or editor generates it (`POST /projects/:id/storyboard/generate`, a button that appears while there is none) or writes it again (**Regenerate**, which asks first); viewers read it (`GET /projects/:id/storyboard`). The prompt is in `server/ai-storyboard.ts` (version `storyboard-v1`): each solution must cite themes by number (T1, T2 ...), a participant figure must be one it was given, the research text is data not instructions, and contact details are masked; an unusable reply is retried once and then saves nothing (503 `ai_output_unusable`). The call is `purpose = 'storyboard'` (listed under **Admin > AI usage and costs** as Storyboard) and uses the drafting model (`AI_DRAFT_MODEL`). With no model, or when the month's budget or the credit is used up, a plain draft from the same themes is saved (`templateStoryboard`, marked `source: 'template'`, trade-offs shown as not estimated) and the page says so. The step is open once the project has a theme. The slides (`src/pages/storyboard/Slides.tsx`) are drawn on a fixed 60 by 33.75 rem canvas and scaled to the width they are shown at (`ScaledSlide`), so the screen and the PDF match; the strip of thumbnails is the same scroll-sideways row as the Recommendations on Platform Themes (`useStrip`). **Download as PDF** prints the deck: a copy of the six slides at full size is drawn after the app (hidden on screen), printing hides the app, and a `@page { size: 10in 5.625in }` rule added only while printing makes each slide a landscape 16:9 page; the document is named after the project, so the browser offers that as the file name (choose Save as PDF in the print dialog). A PPTX download is not built. The old project address `/projects/:id/journey` leads to `/storyboard`. The Journey Map code (`src/pages/themes/JourneyView.tsx`, `JourneyPage.tsx`, `journeyMap.ts`, its Backstage and User flow rows) is kept in the repository, unrouted, in case it comes back; the API behind it (`/projects/:id/blueprint`, `/workflow`, `/stage-map`) is unchanged. With no project-level picker, nothing in the app puts a project on a workflow except the Anchor CX example; the platform Workflows view lays research over a workflow only for projects already on it, and deleting a workflow takes its projects off it.

**Workflows (the service blueprint).** A workflow is the blueprint of one app or feature, such as Anchor CX's "Customer success lifecycle": ordered stages, and for each stage *what good looks like*, the *signal to watch*, the *handoff* out of it, and the **backstage** under it (teams, systems and processes, each with an owner). It is edited once, under **Platform Insights > Workflows** (the tab was called Journey until 2026-11-06; its address is still `/insights/journey`): the Workflow picker, then **Edit Workflow** at the right of that row, which gives way to the editor, where **Delete**, **Cancel** and **Save** sit at the right of the workflow's name and description (Delete asks "Delete <name>?" first, saying how many projects it takes off the workflow) and **Add stage** is a slim lane (a "+" in the dark header) at the far right of the stages, which scrolls into view when a stage is added; **New Workflow**, a black button above the content at its right edge, as Save is on the Test Plan; **Add the Anchor CX example** adds that workflow from `server/workflow-samples.ts`, offered while it is missing, and puts on it every project that is on no workflow and whose journey stages all match its stages by name, which is the three Anchor CX studies, so the journey opens as the Anchor CX aggregate), by anyone with edit access (owners and editors; viewers read). Teams will refine who may edit it. Tables (migration 0033, additive): `insights.workflows`, `workflow_stages`, `workflow_backstage`, `project_workflows` (a project is on at most one workflow; kept apart from `core.projects` so choosing one does not bump the project's version and cause a false "someone else saved" on its test plan), and `research.study_stages.workflow_stage_id` (which workflow stage a project's journey stage means). A workflow is saved whole (`PUT /workflows/:id` with `If-Match`; a stage or backstage entry that keeps its `id` is changed in place so mappings survive a rename) and a save that changes nothing keeps its version. A project is put on a workflow with `PUT /projects/:id/workflow` (the project Journey Map's picker did this until it was replaced by the Storyboard; now only the Anchor CX example does it in the app); its stages map to the workflow's by name (`matchStage`: an equal name, else the one stage whose name contains or is contained by it) and each can be unmapped or mapped by hand (`PUT /projects/:id/stage-map`). Its **Backstage** row then reads the blueprint (name, owner, handoff) instead of the simulation, which remains for a project on no workflow. A workflow's journey (`GET /insights/journey?workflow=<id>`, `getWorkflowJourney` in `server/journey.ts`) is the blueprint's own stages with the themes, pain points, opportunity and sentiment of the projects on it laid over them, who is in each stage (participants grouped by the first part of their role, with the theme most of them raised there), and a **Trace a persona** control that highlights where one is. **All studies (by stage name)** keeps the earlier rollup of every analysed project. Every save, creation and deletion, and each project's choice of workflow and stage mapping, goes to the audit log (**Admin > Audit log**), a save as a list of what changed (`diffWorkflow`). The editing logic is in `src/pages/insights/blueprintDraft.ts`, tested without React.

The user-flow row (simulated numbered steps per stage: the stage as the start, the two strongest themes, a *Keeps going?* decision, then where they go next) was a row of the project Journey Map; `stageFlow` in `src/pages/themes/journeyMap.ts` still works it out, unused for now. The Platform Insights journey keeps its Sentiment chart.

**Priorities** is the importance-against-effort map across the whole page (there is no side panel; the map is the point of the page). Each theme is a node. Editors drag it to a cell, or use the **three-dot menu** on the node (Move up, Move down, Move right, Move left, Reset to suggestion: up is more important, right is more effort; `movePatch` in `themeEdits.ts`), which exists for people who cannot drag. The node's details (category, who raised it, the suggestion, the effort note) open in a Carbon popover beside it after **two seconds** of rest with the pointer or keyboard focus (`DETAILS_DELAY_MS` in `PriorityNode.tsx`), at once on a click or tap, and close on leaving, a second click or Escape. The panel is not rendered until it is open: a closed Carbon popover keeps its box, and it would sit unseen over the node below and take its pointer. On a narrow screen the row labels shrink and the three columns share the width. The app is built for tablet portrait (744 to 1024px) and up: a browser check loads the main pages at 744 and 1024 and fails if any scrolls sideways (a wide table or map scrolls inside its own box instead; a screen-reader-only label must sit inside that box, or it stretches the page).

## Stories: the hand-off to Jira

The Stories step is not a board. **Prepare for Jira** lists the requirements still to send (open questions are apart, under *Needs a decision*, and are never ticketed) and shows the selected one in full and read-only, with its Evidence (participants, theme, and the link that goes into the ticket) and, in a strip at the bottom, the Readiness checks, Create Jira ticket and Copy as Markdown. A sent requirement leaves that list; with none left to prepare the page opens on **Sent to Jira** (a tab chosen by hand is kept in the address, `?tab=`). **Create Jira ticket** opens the one dialog where anything is edited, pre-filled from the story; what is sent is kept in `delivery.story_tickets` (migration 0032: key, project, type, summary, description, priority, assignee, labels, points, who, when) and listed on **Sent to Jira**. The Jira connection is **simulated**: the key (PLAT-215, PLAT-216 ...) follows the project's own sequence here and nothing reaches Jira; each ticket says `simulated: true`. `GET /projects/{id}/tickets` (anyone) and `POST /stories/{id}/tickets` (owners and editors, once per story). The ticket's description ends with a link back to the story. Stories are never created by hand: they come from the requirements document, and Update board never removes one that has a ticket. The prototype this came from is in `design-handoff/stories/`. The old Kanban routes (move, undo, patch, checklist) are unused and are on the cleanup list.

## The shell

A dark rail down the left (`src/shell/AppShell.tsx`: the app's name, then Platform Insights, Product Funnel, Admin, the Prototype gallery and the Decision Guides, which open `galleryUrl` and `decisionGuidesUrl` from `brand/brand.json` in another tab), a slim bar across the top (the account and editing state), and inside a project a project-name bar (it starts with an **All projects** back link, with a chevron, in link blue and smaller than the name; the bar's glow sits to the right of the name so the link and name are on white) and the step strip (`--at-surface-slate`, a grayish blue shared with the open recommendation box on Platform Themes). Their left edges line up with the page title below. On narrow screens the rail is replaced by a menu in the top bar. Panel headings use the `panel-title` type role everywhere (Themes, Priorities, Stories), section headings inside a panel use `eyebrow`, and body text `body-md`.

The top bar carries the **AI: live / simulated** badge at its left and, at its right, the signed-in person's picture (`src/auth/AccountPanel.tsx`). The picture comes from the sign-in provider, is kept in `core.users.avatar_url`, refreshed at the next sign-in when it changes, and reported as `avatarUrl` by `GET /me`; without one, initials stand in. Clicking it opens a panel (Carbon `Popover`) with a larger picture, name, email, role, Members and Sign out (Members and AI usage and costs are Admin tabs).

Form fields share the buttons' look: white fill, the light hairline border all round (the strong border on hover), and `rounded.md` corners, set once in `src/theme.scss` (Form fields). The focus ring stays Carbon's, in ink.

## Customer and team feedback

Transcripts have a source (migration 0030 `research.transcripts.source`: `customer`, the default, or `team`). The Transcripts page has two tabs, **Customer feedback** (the default) and **Team feedback**, with identical add, review and save; a file or sample added on a tab takes that tab's source. Team transcripts are conversations with CSMs, Support, Sales and others: they are analyzed together with the customer sessions and meld into the same themes, but they are **confirmation, never reach**.

- **Reach and priority are customers only** (migration 0031 replaces the view `research.theme_stats`): `participantCount`, `totalParticipants` and `mentionCount` count customer transcripts; `team_mention_count` and `team_session_count` count the team's. The platform overview, personas, case-study quotes and case briefs follow (a team speaker is never a persona or a case-study quote).
- **Origin is derived, never hand-tagged** (`server/origin.ts`): a theme is `customer`, `team` or `both` from the transcripts behind its quotes, with `teamSessions`. Every Platform Themes row shows it as a quiet outline tag (Customers, Team, Customers + Team); the open row says "Also discussed in N team conversations, which confirms it but does not count toward reach", or for a team-only theme that it does not count yet. Project Themes cards and quotes carry it too (a team quote says "Team conversation").
- **Internal feedback never stands alone** (David, Nov 3): a theme with no customer reach is not ranked and is never an opportunity; team conversations only add nuance and a small bounded weight (`TEAM_WEIGHT_EACH` 5%, `TEAM_WEIGHT_CAP` 10% in `server/insights.ts`) to a theme customers raised.
- **The analysis is told** (prompt `analysis-v3`): each transcript is labeled `(team conversation)` when it is one, and a rule says team input is second-hand, may confirm and show behaviors and usage patterns, and is never an opinion-only basis for a theme. `public/privacy.html` says each transcript is labeled. A team transcript adds `:team` to the analysis key, so changing a source makes the analysis out of date while existing analyses keep their key.

The Trend column on Platform Themes is a small line chart (`Sparkline.tsx`) of the share of each project's participants who raised the theme, oldest project first (`trendSeries` on `GET /insights/themes`), coloured by the trend (green growing, coral fading, quiet otherwise). Its accessible name and hover note carry the words and the percentages. Search, Order and Group by sit left, middle and right above the table.

Every project step shares one centered column, 75rem wide (`.column` in `AppShell.module.scss`), as Platform Insights, Product Funnel and Admin do; the project-name bar and the step strip sit in the same column, so the name, the first step label and the page title share a left edge. Pages set no width of their own.
