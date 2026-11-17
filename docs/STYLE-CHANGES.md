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

## Queued (decided, to be made together with the typography work)

- **Requirements page title** (noted 2026-11-17). Most pages title themselves with the object type (Test Plan, Participants, Storyboard).
  The Requirements page (`src/pages/requirements/WriterView.tsx`) uses the document's own name as the h1 (for example "Health score
  explanations"), and the same name appears again in the line under it ("Built from ..."). Change the h1 to **Requirements**, and keep the
  line under it as the description ("Built from <project> · N sessions · N themes"). The document's name stays visible there. A stand-alone
  document (no project) keeps its own name, since it has no object type to share. The Published / Draft tag and "Start over" stay on the
  title row. Check the e2e tests that read this title.
- **One page title size** (from the audit): 32px on every page, including Platform Insights (now 40px).
- **Heading ladder** (from the audit): page title 32, section heading 20, item or subsection 16, group label 14 medium muted, body 14, meta 12.
  Test page: the published Requirements page, which has all four heading levels in one view.
