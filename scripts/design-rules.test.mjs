// The pinned design rules: the copy is the one recorded in SOURCE.json, it works with no other checkout, and it still catches
// what the design system forbids.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validatePage } from '../vendor/design-rules/validateRules.ts'

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
