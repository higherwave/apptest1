# Style changes

A running record of decisions that change how the app looks, in the order they were made, so the style guide can be written from facts.
Each entry says what changed, why, where it lives, and how to undo it. Newest last. The audit that started this (2026-11-17) is the
"Signal Flow style audit" page; the order of work is typography first, then the rest, and the menu background, selected-tab colour and
primary colour together, last.

## Standing rules

- **Sentence case everywhere** (2026-11-17). Every label, heading, column header, button and tag is written in sentence case: the first
  word and proper names are capitalised, acronyms stay as written (AI, PDF). Nothing changes the case of text with CSS: no
  `text-transform: uppercase | capitalize | lowercase`. Guarded by `scripts/case.test.mjs`; also a rule in the company registry
  (`vendor/design-rules/tokens.json`, `airtable.rules`). Put `case:ignore` on the same line only for stored data that must keep its case.

- **Heading ladder** (decided 2026-11-18, taken from the Themes page; it replaces the Requirements-page guideline): each level is one type role in `src/tokens.scss`,
  so a change to a level reaches every heading of that level. `heading-1` the page title (h1), 32px regular; `heading-2` a detail pane's heading (h2), 22px medium;
  `heading-3` a card title (h3), 16px medium; `heading-4` a smaller heading (h4), 16px in the medium weight (the paragraph size, a little heavier);
  `page-description` the line under a page title, 16px regular. Other roles: `reading-md` 14px for paragraphs; `meta` 12px; `button` 14px; `caption` 12px medium
  (kept free for the prototype screenshot); `label-md` and `body-md` unchanged; `eyebrow` (14px medium, sentence case) is the group label above a section.
  Storyboard slides are outside it. Enforced by the linter (rule `heading-roles`, 2026-11-18): a heading takes `heading-1` to `heading-4`; `display-*`, `title-*` and `panel-title` are only for what is not a heading (a large number, a brand name) and need a `// not-a-heading: why` comment on or above the line, or `// not-a-heading-file: why` at the top of a file (storyboard slides). The roles are in the registry (design-system repo), so the linter knows them.

## Log

### 2026-11-17: All capitals removed

- **What:** the `eyebrow` (14px) and `eyebrow-sm` (12px) type roles no longer set `text-transform: uppercase` or 0.06em letter spacing.
  Size, weight and colour are unchanged, so the labels are the same size and weight, now in the case they are written in. 53 uses in about
  30 files change together. The launch export and PDF (`server/launch-export.ts`: the eyebrow and the table headers) follow.
- **Why:** capitals came from our own type roles (not Carbon, not the Airtable design file) and were used for section headings at three
  heading levels, which made them hard to tell apart. Sentence case reads more calmly and is easier to scan.
- **Where:** `src/tokens.scss` (roles), `server/launch-export.ts`, the registry text in the design-system repo (commit 1e514cc), synced into
  `vendor/design-rules/`.
- **Undo:** restore the two lines (`letter-spacing: 0.06em; text-transform: uppercase;`) in the roles, and revert the registry text.
- **Left as is:** the role names (`eyebrow`) and the heading sizes. The next step in typography is the heading ladder and one page title size.

### 2026-11-17: Platform Themes highlight panel (the "Start here" panel), colours

- **What:** three passes. (1) An indigo ground with a violet glow at the upper right and a teal glow at the lower left (Scheme 6a, "Aurora"). (2) The menu's
  gray blended in: gray at the lower left fading into indigo. (3) After review: mostly the menu's gray, only a trace of indigo at the upper right and a faint
  teal at the lower left, and the white button's text is the menu gray too. One token, `--at-panel-aurora` (and `--at-panel-ink`), in `src/theme.scss`.
- **Why:** the panel next to the multi-coloured header graphic was too much colour; the gray tie to the menu reads calmer.
- **Undo / adjust:** the earlier gradients are in the comment above the token. Raise the two glow percentages for more colour.

### 2026-11-17: Primary colour is the menu gray

- **What:** the primary fill (buttons, the active tab, dark surfaces such as slides and tooltips) is now the menu's gray, #2A2D34, instead of the near-black
  #181d26 (hover #1F2228). The near-black stays only as the text colour (`--at-ink`). The menu uses the same token (`--at-rail` is `--at-primary`). The landing
  and about pages' buttons follow. Switches were not black (they use the link blue) and are unchanged.
- **Where:** `src/theme.scss` (`--at-primary`, `--at-primary-active`, `--at-surface-dark`, `--at-rail`), and the registry's hover colour in the design-system repo.
- **Undo:** put #181d26 and #0d1218 back in those two tokens (and the registry mapping).

### 2026-11-17: Header glow lighter

- **What:** the soft violet and blue glow behind page titles (Platform Insights and the other hero pages, and the project header) was 60% violet and 40% blue.
  It is now 28% violet and 30% blue, so the link to the landing page stays but is quieter. Two tokens: `--at-glow-violet-mix` and `--at-glow-blue-mix`.

### 2026-11-17: Requirements page title

- **What:** the h1 is **Requirements**, like the other pages (Test Plan, Participants, Storyboard), and the line under it still says "Built from <project> · N sessions · N themes". A stand-alone document, which has no project, keeps its own name. (`WriterView.tsx`.)

### 2026-11-17: Typography decisions (to review live, then decide whether to make them the checked standard)

- **One page title size:** every page title is `display-md`, 32px regular. Platform Insights and the other hero pages (Settings, Launches, Trash, Projects,
  Measure) were `display-lg`, 40px; they now match the project pages. (`src/shell/PageHero.module.scss`.)
- **Storyboard is its own context.** Its slides, which can be downloaded, edited and re-themed, keep their own type styles and are outside the app's heading
  hierarchy. The current look stays.
- **Kept as they are:** `label-md` (16px medium) for item names and field labels, as long as it is used the same way across the app; Carbon's button text;
  `meta` (12px) for small supporting text.
- **No all capitals** (see above). A later, deliberate use of capitals as an offset is possible; for now none.
- **Heading ladder:** adopted as the current guideline, as shown on the Requirements page (see Standing rules). Not enforced by the linter yet, and codifying it is on hold (2026-11-17): live with it first.

## Queued (decided, not yet made)

- Nothing queued.

### 2026-11-18: Tags (badges) are soft tints

- **What:** Carbon's bright tag fills are replaced by soft tints with dark text, in one place (the Carbon tag variables in `src/theme.scss`). Green (done, worked) is a mint tint with
  dark green text, red (needs attention) a coral tint, gray a light gray, warm gray a sand tint, and the cool colours (purple, teal, blue) pale tints with dark text of the same hue.
  Every pair is at least 6.4:1. The outline tag keeps a quiet gray edge. Tags are pills (`--at-radius-full`), matching the success view and the Measure design; the registry rule now says so.
- **Why:** Carbon's tags were too bright and distracting; the soft palette was already used in the success view and the Measure design.
- **Undo / adjust:** delete the `--cds-tag-*` block, or change a pair there. To go back to the small corner, set the radius in the `.cds--tag` rule to `--at-radius-sm` (and the registry rule).

### 2026-11-18: Heading roles

- **What:** `heading-1` to `heading-4` and `page-description` added (see Standing rules). Applied so far: every page title (h1), the line under it, and the Themes page's
  detail heading and card title. `button` is now 14px, `caption` 12px; the five places that used `caption` for a group label now use `eyebrow` (same look as before).
- **Sweep (2026-11-18):** the rest of the app's headings now use the ladder, so a future change to a level is global. `heading-2` (22px medium): launch name, Measure panel title,
  launch success heading, Stories title, resume panel project, project card name (were `title-md`, 20px regular). `heading-3` (16px medium): launch stage and document titles,
  setup step names, account name, tour and welcome titles, case study / customer / journey stage names, empty-state titles (were `title-md` or `title-sm`), plus the
  panel, section, requirement and item titles that already looked like it (were `label-md`). Left alone: big numbers, the app name, footer brand, avatar, and the storyboard slides.
  Row names (people, trash, areas, launches list) are still `label-md`.

## Ideas to discuss

- **Dark mode that follows the system** (2026-11-17): feasible because every colour is a token; needs the token and contrast checks to understand dark values, a Carbon audit, new primary and menu values, dark soft colours, and a screenshot pass. Suggested: a spike on a few screens first (a dark palette, following the system, about six key screens, judged visually before committing to the full pass), and no manual toggle in the first version. Rough estimate: about a day for the spike, a few days for the full pass with the tooling. **Parked for December (decided 2026-11-17).**
  What the full pass involves: the token check and contrast check (design-system repo) must accept scoped dark values and check dark pairs; audit Carbon's own variables (fields, layers, focus) in dark; new dark values for the primary and the menu (the primary is now the menu gray, so buttons and the active tab need a light fill in dark); dark versions of the status tints, tags, charts, Aurora panel and header glow; exports, PDFs, the public landing, about and privacy pages and the storyboard slides stay light unless decided otherwise; a screenshot pass of every main screen in both themes and a dark browser-test run; and from then on every new component is designed and checked in both.

## 2026-11-18: Title region is a slate blue wash
- **What:** the title region of every page (PageHero, and the bar behind the project's name) was white with a violet/blue glow and a bottom border. It is now `--at-title-wash`:
  a top-to-bottom gradient from pale slate blue (rgb 235 240 247) into the page colour, with no border, so it bleeds into the page. The glow tokens (`--at-glow-*`) are no longer used by any page.
- **Why:** quieter than the glow, and it matches the gray primary; the header no longer reads as a separate white strip. The section switch on Insights stays white, as in the mock.
- **Registry:** the wash colour is `--at-title-wash-top` (#ebf0f7), in the colour registry (added 2026-11-18, at David's go-ahead).

## 2026-11-18: In a project, the step rail runs up flush under the app bar
- **What:** on wide windows (1024px and up) the project's step rail starts directly under the app bar. The project bar (All projects | name | status, with the slate blue wash) stays
  at the top of the page but starts to the right of the rail instead of spanning the full width. Narrower windows keep the full-width bar and the steps strip.
- **Why:** the rail now meets the app bar cleanly and the title region runs up against the rail.

## 2026-11-18: The heading ladder is a linter rule
- **What:** rule `heading-roles` in the design-system repo. Using a sized role (`display-*`, `title-*`, `panel-title`) in a stylesheet fails the check unless the line says `// not-a-heading: why`. Headings use `heading-1` to `heading-4`.
- **Limit:** it cannot tell that a `label-md` is really a heading (that role is also for labels), and it checks styles, not which HTML element the class lands on. Reviewing a new heading is still on a person.
- **Setup page title** moved from `display-md` to `heading-1` (same look).

## 2026-11-18: Requirements document looks like the Stories view
- **What:** the "Product brief" and "Requirements document" headings on the Requirements page are h2 (heading-2). The document panel is white with each section a gray block (the Stories view's `.block` and `.blockHead` styles, copied), with body-md text.

### 2026-11-19: Highlight panel background (Platform Insights "Start here" panel)

The panel's background is now the LinkedIn banner's ribbons (blue, violet, teal, mint, with no lines or dots) at 55% opacity, fading into the
original dark gray (the menu rail colour) at the left so the text there sits on plain gray. It replaces the purple and teal glows.
Lives in `--at-panel-aurora` in `src/theme.scss` (an inline SVG, so no image file). Why: David's choice after trying a lighter gray, a slate blue
base and a slate-blue highlight. Legibility checked by eye on the task list (the ribbons are the weakest spot; the first try at 75% was too bright).
To undo: restore the previous `--at-panel-aurora` (two radial glows over a 115deg gradient from the rail colour) from git.

## 2026-11-20: the app header and launcher replace the left icon strip

- The 68px dark icon strip down the left (opening to 240px on hover) is gone. A dark bar (`--at-rail`) now runs across the top of every page: the launcher (nine dots) at the left, the
  current app's one-colour mark and name, its items, and at the far right the AI badge, "Take a tour", Admin and the account. The project step rail and project bar are unchanged and now start at the left edge.
- The launcher opens a panel of cards: Platform Insights (the suite home, a plain tile) first, then Signal Flow and, for an owner with the preview on, Pulse, with the full-colour icons; the
  Prototype gallery and Decision Guides links sit at the foot of the panel.
- Width: below 68rem the AI badge goes and "Take a tour" keeps only its icon; below 60rem the items fold into one menu (tablet portrait).

## 2026-11-21: the title bar and a horizontal menu for projects and Admin

- Inside a project and inside Admin, the vertical step rail and the tall Admin title area are replaced by a slim title bar (3rem, `--at-surface-soft`) under the app header: the project's back arrow, name and status, or "Admin"
  (and, for an owner, "Set up your workspace"). Four soft, blurred ribbons sit at its right and fade out toward the left (`TitleBar`; colours `--at-signature-mint`, `--at-link`, `--at-glow-violet` and the new `--at-ribbon-sky`,
  `-lilac`, `-teal`, `-mask`, registered upstream in design-system-mcp). From design-handoff/title-and-menu.
- Under the title bar a horizontal menu (`SectionNav`) shows the groups with their names above them: a project's Discovery, Analysis, Strategy and Delivery steps (set-up states and locks kept), and Admin's Experience Categories
  (Categories, Matches), Usage and Costs (AI, System), Communication (Notifications), User Access (People, Teams, Approvals), Data and Compliance (Data, Audit log), Pulse (owners, while the preview is on) and Previews.
  Admin's former in-page tabs and its title area are gone; the menu's items open the same pages (`?tab=` in the address).
- Width: under 56.25rem (tablet portrait) the group names drop away and the spacing tightens, so all ten steps stay in one row at 820px; under 40rem (a phone) the row becomes one button ("Analysis › Themes") that opens the
  groups as a list. The page's padding narrows with the window (`--at-content-pad`), and the page's title area follows it. On a phone the app header also drops "Take a tour" and the app mark.
- The Platform Insights launcher card uses its own full-colour icon (design-handoff/app-icons/platform-insights) instead of the plain tile.
- To undo: restore `AppShell.tsx`, `StepNav.*` and `SettingsHeader.tsx` from git (commit before this entry).
