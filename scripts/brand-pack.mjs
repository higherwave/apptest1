// A brand pack is the folder of files that make this app look and sound like one company. These commands move it in and out:
//
//   npm run brand:export -- /path/to/acme-brand            copy this app's current brand into a folder, as a starting point
//   npm run brand:apply  -- /path/to/acme-brand            show what applying a pack would change
//   npm run brand:apply  -- /path/to/acme-brand --yes      install it
//
// The pack has the same shape as MANIFEST below: brand.json (names and contact), theme.scss and tokens.scss (the only files that
// define colors and type), DESIGN.md (the brand in words), assets/ (logo and icons) and, for the design-system-mcp repo, the
// matching registry-tokens.json. Applying checks the whole pack first and writes nothing if any of it is missing or invalid.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadBrand } from './brand.mjs'

const root = resolve(import.meta.dirname, '..')
const ASSETS = ['logo.png', 'landing-icon.png', 'favicon-32.png', 'favicon-64.png', 'favicon.ico', 'apple-touch-icon.png']
export const MANIFEST = [
  { pack: 'brand.json', live: 'brand/brand.json', note: 'app, company and contact names' },
  { pack: 'theme.scss', live: 'src/theme.scss', note: 'colors, radii, spacing as --at-* tokens' },
  { pack: 'tokens.scss', live: 'src/tokens.scss', note: 'type roles' },
  { pack: 'DESIGN.md', live: 'design-system-source/DESIGN.md', note: 'the brand in words and values' },
  ...ASSETS.map((a) => ({ pack: `assets/${a}`, live: `public/${a}`, note: 'logo and icons' })),
]
// Not part of this app: it belongs in the design-system-mcp repo (registry/tokens.json) and is checked there and by check:tokens.
export const REGISTRY_FILE = 'registry-tokens.json'

export function exportPack(appRoot, dir) {
  for (const f of MANIFEST) {
    const to = join(dir, f.pack)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(join(appRoot, f.live), to)
  }
  const registry = join(appRoot, 'vendor', 'design-rules', 'tokens.json')
  if (existsSync(registry)) copyFileSync(registry, join(dir, REGISTRY_FILE))
  return MANIFEST.map((f) => f.pack)
}

/** Problems with a pack folder; an empty list means it can be applied. */
export function checkPack(dir) {
  const problems = []
  for (const f of MANIFEST) if (!existsSync(join(dir, f.pack))) problems.push(`missing ${f.pack} (${f.note})`)
  if (existsSync(join(dir, 'brand.json'))) {
    try { loadBrand(join(dir, 'brand.json')) } catch (e) { problems.push(e.message) }
  }
  if (existsSync(join(dir, 'theme.scss'))) {
    const theme = readFileSync(join(dir, 'theme.scss'), 'utf8')
    if (!/--at-ink\s*:/.test(theme) || !/--at-canvas\s*:/.test(theme)) problems.push('theme.scss does not define the --at-* tokens the app uses (--at-ink, --at-canvas, ...): start from an exported pack')
  }
  return problems
}

export function applyPack(appRoot, dir, { write = false } = {}) {
  const problems = checkPack(dir)
  if (problems.length) throw new Error(`The pack at ${dir} cannot be applied:\n  ${problems.join('\n  ')}`)
  const changed = MANIFEST.filter((f) => {
    const live = join(appRoot, f.live)
    return !existsSync(live) || !readFileSync(live).equals(readFileSync(join(dir, f.pack)))
  })
  if (write) {
    for (const f of changed) {
      mkdirSync(dirname(join(appRoot, f.live)), { recursive: true })
      copyFileSync(join(dir, f.pack), join(appRoot, f.live))
    }
  }
  return changed.map((f) => f.live)
}

if (process.argv[1] === import.meta.filename) {
  const [cmd, dirArg, ...rest] = process.argv.slice(2)
  if (!['export', 'apply'].includes(cmd) || !dirArg) {
    console.error('Usage: brand-pack.mjs export <dir> | apply <dir> [--yes]')
    process.exit(1)
  }
  const dir = resolve(dirArg)
  try {
    if (cmd === 'export') {
      const files = exportPack(root, dir)
      console.log(`Wrote ${files.length} files to ${dir}. Edit them, then: npm run brand:apply -- ${dirArg}`)
    } else {
      const write = rest.includes('--yes')
      const changed = applyPack(root, dir, { write })
      console.log(changed.length ? `${write ? 'Updated' : 'Would update'}:\n  ${changed.join('\n  ')}` : 'Nothing to change: the app already has this brand.')
      if (!write && changed.length) console.log('\nDry run. Add --yes to install it.')
      if (write && changed.length) console.log(`\nNext: put ${REGISTRY_FILE} into the design-system-mcp repo as registry/tokens.json, run npm run rules:sync, then npm run check:all.`)
    }
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
