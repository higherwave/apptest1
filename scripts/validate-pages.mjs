// Runs the design-system validator over every page and style file, locally. Same rules the
// MCP server applies to validate_page, so a failure here is a failure there.
//   npm run validate:pages            uses the pinned copy in vendor/design-rules/ (no other checkout needed)
//   MCP_REPO=/path npm run validate:pages   uses that design-system-mcp checkout instead, to try a rule before publishing it
//   npm run rules:sync                refreshes the pinned copy; npm run rules:check says whether it is behind
// theme.scss and tokens.scss are excluded: they are the token definitions (hex values and type roles,
// including letter-spacing in px), written once so that every other file can use the tokens and the type mixin.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const override = process.env.MCP_REPO ? resolve(process.env.MCP_REPO) : undefined
const rulesFile = override ? join(override, 'lib', 'validateRules.ts') : join(root, 'vendor', 'design-rules', 'validateRules.ts')
const registry = override ? join(override, 'registry') : join(root, 'vendor', 'design-rules')
const { validatePage, optionsFromProfile } = await import(pathToFileURL(rulesFile).href)
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
// Which design system governs this product comes from its profile; design-rules.config.json (at the repo root) adds this app's own
// restrictions on top. It can restrict more components; it cannot allow what the profile restricts or switch a rule off.
const local = existsSync(join(root, 'design-rules.config.json')) ? readJson(join(root, 'design-rules.config.json')) : {}
const options = optionsFromProfile(readJson(join(registry, 'profile.json')), readJson(join(registry, 'components.json')), readJson(join(registry, 'tokens.json')), { restricted: local.restricted ?? [] })
if (override) console.log(`Rules from ${override} (MCP_REPO)\n`)
else {
  const source = JSON.parse(readFileSync(join(root, 'vendor', 'design-rules', 'SOURCE.json'), 'utf8'))
  console.log(`Rules from vendor/design-rules (${source.repo} @ ${String(source.commit).slice(0, 7)})\n`)
}

const EXCLUDE = new Set(['src/theme.scss', 'src/tokens.scss'])
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const files = walk(join(root, 'src'))
  .map((p) => relative(root, p))
  .filter((p) => /\.(tsx|scss)$/.test(p) && !EXCLUDE.has(p))
  .sort()

let failed = 0
for (const file of files) {
  const r = validatePage(readFileSync(join(root, file), 'utf8'), options)
  if (r.pass) console.log(`  pass  ${file}`)
  else {
    failed++
    console.log(`  FAIL  ${file}`)
    for (const v of r.violations) console.log(`          ${v.rule} (lines ${v.lines?.join(', ')}): ${v.message}`)
  }
}
console.log(`\n${files.length - failed} of ${files.length} files pass`)
process.exit(failed ? 1 : 0)
