# Whirl (apptest1)

A React rebuild of the `Whirl App` prototype (originally authored as a Design
Component in `Whirl App.dc.html` + `support.js`), using [Carbon Design
System](https://carbondesignsystem.com/) (`@carbon/react`) components and
tokens throughout.

This app exists to pilot the design-to-code pipeline: every page component in
this repo was checked against
[`higherwave/design-system-mcp`](https://github.com/higherwave/design-system-mcp)
(the MCP server that fronts the [`higherwave/mcp`](https://github.com/higherwave/mcp)
Carbon design-system schema) via its `validate_page` tool before being
committed, and passed with zero violations.

## Stack

- [Vite](https://vitejs.dev/) + React
- [`@carbon/react`](https://www.npmjs.com/package/@carbon/react) for components
- Sass modules using Carbon's spacing (`$spacing-01`…`$spacing-13`) and type
  (`type.type-style(...)`) tokens, plus the runtime `--cds-*` CSS custom
  properties for color — no hardcoded hex values or raw pixel spacing/type.

## Structure

- `src/data.js` — static content extracted from the original DC prototype
  (nav items, provenance rules, integration graph nodes/edges, review diffs).
- `src/components/Sidebar.jsx` — primary left nav + domain list.
- `src/components/ProvenanceTag.jsx` — shared `Tag` wrapper mapping the
  prototype's config/confirmed/inferred provenance pills onto Carbon `Tag`
  types.
- `src/components/views/` — the four screens from the original prototype:
  - `ChangeWorkspace` — pipeline stage strip, human-checkpoint banner, design
    spec `DataTable`, entities/connectors rail.
  - `KnowledgeBase` — breadcrumb, audience-lens `Tabs`, fact list with
    confirm/correct actions, change history rail.
  - `IntegrationGraph` — lane-based dependency diagram (SVG edges + Carbon
    `Button`-based nodes), node detail rail.
  - `ReviewPackets` — approval gate, per-system diffs, handoff/audit rail.

## Governance notes

Per the design-system schema (`list_components` / `list_design_tokens`):

- Raw `<button>`, `<input>`, `<select>`, `<textarea>`, and `<table>` are
  disallowed — this app uses Carbon's `Button`, `TextInput`, `DataTable`
  (with `Table`/`TableRow`/`TableCell`) instead throughout, including for the
  diagram nodes in `IntegrationGraph` (styled `Button kind="ghost"`).
- Colors are read from theme custom properties (`var(--cds-background)`,
  `var(--cds-support-error)`, etc.) rather than hex literals; tinted
  surfaces (diff add/remove backgrounds, the approval gate banner) are
  derived with `color-mix()` against those same tokens.
- Spacing and typography come from Carbon's Sass spacing scale and
  `type.type-style()` mixins rather than hardcoded `px`/`font-size` values.

## Deep links

Each view has a hash URL, so links can point past the home page:

| View | Link |
| --- | --- |
| Change workspace (default) | `/#/workspace` |
| Knowledge base | `/#/knowledge` |
| Integration graph | `/#/graph` |
| Review packets | `/#/packets` |

The hash is the source of truth (see `App.jsx`): clicking the sidebar
updates it, and back/forward and pasted links restore the view. No server
rewrites are needed. An unknown hash falls back to the Change workspace.
In-page state (selected tab, selected graph node, verify/approve progress)
is not in the URL yet.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
