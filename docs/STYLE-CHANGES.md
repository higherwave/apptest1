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

- **Type standard, for now** (2026-11-17): the styles on the published Requirements page are the working guideline for page structure: page title `display-md`
  (32, regular); section headings 20; item and subsection names `label-md` (16, medium); group labels 14 medium in the muted colour, sentence case; body 14;
  `meta` 12. It is a guideline, not yet a linter rule. If the group labels get missed because they are quiet, revisit them. The storyboard slides are outside it.

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
- **Heading ladder:** adopted as the current guideline, as shown on the Requirements page (see Standing rules). Not enforced by the linter yet.

## Queued (decided, not yet made)

- Nothing queued.
