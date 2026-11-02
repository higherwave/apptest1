// The pinned design rules: the copy is the one recorded in SOURCE.json, it works with no other checkout, and it still catches
// what the design system forbids.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { optionsFromProfile, validatePage } from '../vendor/design-rules/validateRules.ts'

const dir = join(import.meta.dirname, '..', 'vendor', 'design-rules')
const source = JSON.parse(readFileSync(join(dir, 'SOURCE.json'), 'utf8'))
const allowed = JSON.parse(readFileSync(join(dir, 'components.json'), 'utf8')).allowed.map((c) => c.name)

test('the pinned files are exactly what SOURCE.json says, so a hand edit is caught', () => {
  assert.ok(source.repo && source.commit, 'SOURCE.json names the repo and the commit the copy came from')
  for (const [file, meta] of Object.entries(source.files)) {
    const hash = createHash('sha256').update(readFileSync(join(dir, file), 'utf8')).digest('hex')
    assert.equal(hash, meta.sha256, `${file} was edited by hand: change it upstream and run npm run rules:sync`)
  }
})

test('the allowlist has the components the app uses', () => {
  for (const c of ['Button', 'Modal', 'Tag', 'ProgressBar', 'InlineNotification']) assert.ok(allowed.includes(c), `${c} is allowed`)
})

test('the validator passes a clean page and flags raw colors, inline styles, raw px and raw elements', () => {
  const clean = `import { Button } from '@carbon/react'\nexport const A = () => <Button kind="ghost">Go</Button>\n`
  assert.deepEqual(validatePage(clean, { allowedComponents: allowed }).violations, [])
  const bad = `import { Button } from '@carbon/react'\nexport const A = () => <div style={{ color: '#aa2d00', width: '12px' }}><button>Go</button></div>\n`
  const r = validatePage(bad, { allowedComponents: allowed })
  assert.equal(r.pass, false)
  const rules = new Set(r.violations.map((v) => v.rule))
  assert.ok(rules.size >= 3, `several rules fire: ${[...rules].join(', ')}`)
})

test('the type roles in the registry are exactly the roles the role() mixin knows, and the validator rejects any other', () => {
  const registry = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8')).airtable.type.roles.map((r) => r.token)
  const mixin = [...readFileSync(join(import.meta.dirname, '..', 'src', 'tokens.scss'), 'utf8').matchAll(/\$name == '([a-z0-9-]+)'/g)].map((m) => m[1])
  assert.deepEqual([...registry].sort(), [...mixin].sort(), 'src/tokens.scss and the registry list different roles: change both together')
  const r = validatePage(`.a { @include tokens.role('body-xl'); }`, { typeRoles: registry })
  assert.deepEqual(r.violations.map((v) => v.rule), ['type-role-unknown'])
  assert.deepEqual(validatePage(`.a { @include tokens.role('body-md'); }`, { typeRoles: registry }).violations, [])
})

// A mistyped token inside var() with a fallback never fails: the fallback quietly wins. Every --at-* a page uses must be defined,
// except those the page sets itself while it runs.
const SET_BY_SCRIPT = new Set(['--at-banner']) // AppShell sets it to the height of the spend alert, 0 when there is none
test('every --at-* token used in src is defined in theme.scss or tokens.scss (or set by a script on purpose)', () => {
  const src = join(import.meta.dirname, '..', 'src')
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
  const files = walk(src).filter((f) => /\.(scss|tsx)$/.test(f))
  const defined = new Set()
  for (const f of ['theme.scss', 'tokens.scss']) for (const m of readFileSync(join(src, f), 'utf8').matchAll(/(--at-[a-z0-9-]+)\s*:/g)) defined.add(m[1])
  const undefinedUses = []
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/var\((--at-[a-z0-9-]+)/g)) if (!defined.has(m[1]) && !SET_BY_SCRIPT.has(m[1])) undefinedUses.push(`${f.slice(src.length + 1)}: ${m[1]}`)
  assert.deepEqual(undefinedUses, [], 'these tokens do not exist: fix the name or add the token (theme.scss and the registry together)')
})

test('the app’s own restrictions only restrict: real components, each with a reason, none that the profile already restricts', () => {
  const config = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'design-rules.config.json'), 'utf8'))
  const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8'))
  assert.ok(Array.isArray(config.restricted))
  for (const r of config.restricted) {
    assert.ok(allowed.includes(r.name), `${r.name} is restricted here but is not a component in the list`)
    assert.ok(r.reason, `${r.name} needs a reason`)
    assert.ok(!(profile.components?.restricted ?? []).some((p) => p.name === r.name), `${r.name} is already restricted by the profile`)
  }
  const options = optionsFromProfile(profile, JSON.parse(readFileSync(join(dir, 'components.json'), 'utf8')), JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8')), config)
  assert.equal(options.importFrom, '@carbon/react')
  assert.deepEqual(validatePage(`import { Tabs, TabList, Tab, DataTable, Table, TableCell } from '@carbon/react'`, options).violations, [], 'tabs and tables are allowed')
})

test('validate:pages runs from the pinned copy alone', () => {
  const out = execFileSync('node', ['--experimental-strip-types', '--no-warnings', 'scripts/validate-pages.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    // A MCP_REPO left in the environment would point it elsewhere; the point here is that nothing else is needed.
    env: { ...process.env, MCP_REPO: '' },
    encoding: 'utf8',
  })
  assert.match(out, /Rules from vendor\/design-rules/)
  assert.match(out, /\d+ of \d+ files pass/)
})
