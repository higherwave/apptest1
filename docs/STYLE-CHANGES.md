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
