// The brand boundary: names live in brand/brand.json, pages are filled in from it, no company name sits in the code, and a pack
// can be exported and applied whole or not at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { loadBrand, PLACEHOLDER, renderBrand } from './brand.mjs'
import { applyPack, checkPack, exportPack, MANIFEST } from './brand-pack.mjs'

const root = join(import.meta.dirname, '..')
const brand = loadBrand()
const PAGES = ['public/about.html', 'public/privacy.html', 'public/landing.html', 'index.html']

test('placeholders are filled, values are escaped, and a missing value is an error, not a blank', () => {
  assert.equal(renderBrand('Hi {{appName}} / {{ orgName }}', { appName: 'A&B <x>', orgName: 'Acme' }), 'Hi A&amp;B &lt;x&gt; / Acme')
  assert.throws(() => renderBrand('{{nope}}', brand), /no "nope"/)
  assert.throws(() => loadBrand(join(tmpdir(), 'does-not-exist.json')))
})

test('every placeholder in the pages and the app page is a key brand.json has, and none is left after rendering', () => {
  for (const f of PAGES) {
    const html = readFileSync(join(root, f), 'utf8')
    const used = [...html.matchAll(PLACEHOLDER)].map((m) => m[1])
    assert.ok(used.length, `${f} uses at least one placeholder`)
    for (const key of used) assert.ok(key in brand, `${f}: {{${key}}} is not in brand.json`)
    assert.ok(!/\{\{/.test(renderBrand(html, brand)), `${f}: a placeholder was left behind`)
  }
})

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

test('the company name, domain and contact address appear in brand.json only, never in the app or the pages', () => {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'public')), join(root, 'index.html'), ...walk(join(root, 'server')), join(root, 'api', 'index.ts')]
    .filter((f) => /\.(tsx?|scss|html|mjs|js|css)$/.test(f) && !/\.test\.(ts|mjs)$/.test(f))
  const banned = [brand.orgName, brand.orgDomain, brand.contactEmail]
  const hits = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const b of banned) if (text.includes(b)) hits.push(`${relative(root, f)} contains "${b}"`)
  }
  assert.deepEqual(hits, [], 'use brand.json (React) or a {{placeholder}} (static pages) instead')
})

test('the real build output has the names filled in', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'))
  for (const f of ['index.html', 'landing.html', 'about.html', 'privacy.html']) writeFileSync(join(dist, f), f === 'index.html' ? '<title>{{appName}}</title>' : readFileSync(join(root, 'public', f), 'utf8'))
  const { finishBuild } = await import('./finish-build.mjs')
  finishBuild(dist, { ...brand, appName: 'Acme Flow', orgName: 'Acme' })
  for (const f of ['index.html', 'about.html', 'privacy.html']) {
    const html = readFileSync(join(dist, f), 'utf8')
    assert.ok(!/\{\{/.test(html), `${f} has no placeholder left`)
    assert.match(html, /Acme Flow/)
  }
  assert.match(readFileSync(join(dist, 'app.html'), 'utf8'), /<title>\{\{appName\}\}<\/title>/, 'app.html is untouched by this step (Vite filled its title when it built)')
  rmSync(dist, { recursive: true })
})

// A copy of just the brand surface of the app, so applying a pack can be tried without touching the real files.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'brand-'))
  const app = join(dir, 'app')
  for (const f of MANIFEST) {
    mkdirSync(join(app, f.live, '..'), { recursive: true })
    cpSync(join(root, f.live), join(app, f.live))
  }
  mkdirSync(join(app, 'vendor', 'design-rules'), { recursive: true })
  cpSync(join(root, 'vendor', 'design-rules', 'tokens.json'), join(app, 'vendor', 'design-rules', 'tokens.json'))
  return { dir, app, pack: join(dir, 'pack') }
}

test('an exported pack is complete and applying it to the same app changes nothing', () => {
  const s = sandbox()
  const files = exportPack(s.app, s.pack)
  assert.ok(files.includes('theme.scss') && files.includes('assets/logo.png') && files.includes('brand.json'))
  assert.ok(existsSync(join(s.pack, 'registry-tokens.json')), 'the registry tokens travel with the pack for the design-system repo')
  assert.deepEqual(checkPack(s.pack), [])
  assert.deepEqual(applyPack(s.app, s.pack), [])
  rmSync(s.dir, { recursive: true })
})

test('applying a new brand pack changes exactly the brand files, and only with write on', () => {
  const s = sandbox()
  exportPack(s.app, s.pack)
  writeFileSync(join(s.pack, 'brand.json'), JSON.stringify({ ...brand, appName: 'Acme Flow', orgName: 'Acme', orgDomain: 'acme.com', contactEmail: 'privacy@acme.com' }))
  writeFileSync(join(s.pack, 'theme.scss'), readFileSync(join(s.pack, 'theme.scss'), 'utf8').replace('--at-ink: #181d26', '--at-ink: #0b3d91'))
  assert.deepEqual(applyPack(s.app, s.pack).sort(), ['brand/brand.json', 'src/theme.scss'])
  assert.equal(JSON.parse(readFileSync(join(s.app, 'brand/brand.json'), 'utf8')).appName, 'Signal Flow', 'a dry run writes nothing')
  applyPack(s.app, s.pack, { write: true })
  assert.equal(JSON.parse(readFileSync(join(s.app, 'brand/brand.json'), 'utf8')).orgName, 'Acme')
  assert.match(readFileSync(join(s.app, 'src/theme.scss'), 'utf8'), /--at-ink: #0b3d91/)
  assert.deepEqual(applyPack(s.app, s.pack), [], 'and then there is nothing left to change')
  rmSync(s.dir, { recursive: true })
})

test('a pack that is incomplete or invalid is refused whole, and nothing is written', () => {
  const s = sandbox()
  exportPack(s.app, s.pack)
  writeFileSync(join(s.pack, 'brand.json'), JSON.stringify({ appName: 'Only a name' }))
  rmSync(join(s.pack, 'assets', 'logo.png'))
  writeFileSync(join(s.pack, 'theme.scss'), ':root { --brand: red; }')
  const before = readFileSync(join(s.app, 'src/theme.scss'), 'utf8')
  assert.throws(() => applyPack(s.app, s.pack, { write: true }), (e) => /missing assets\/logo\.png/.test(e.message) && /"orgName" is required/.test(e.message) && /does not define the --at-\* tokens/.test(e.message))
  assert.equal(readFileSync(join(s.app, 'src/theme.scss'), 'utf8'), before)
  rmSync(s.dir, { recursive: true })
})
