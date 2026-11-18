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
  Storyboard slides are outside it. Not yet enforced by the linter. The roles are in the registry (design-system repo), so the linter knows them.

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
- **To revisit:** the wash colour is not in the colour registry (written as rgb()); add it there if it stays.

## 2026-11-18: In a project, the step rail runs up flush under the app bar
- **What:** on wide windows (1024px and up) the project's step rail now starts directly under the app bar and carries the way back ("All projects") and the project's name
  at its top; the separate project bar is gone, so a page's title region runs up against the app bar and the rail. Narrower windows keep the project bar and the steps strip.
- **Why:** the title region used to sit under a second bar and beside the menu; now it meets the rail and the app bar cleanly.
