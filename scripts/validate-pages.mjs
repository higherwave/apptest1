// Runs the design-system MCP validator over every page and style file, locally. Same rules the
// MCP server applies to validate_page, so a failure here is a failure there.
//   npm run validate:pages            uses ../design-system-mcp
//   MCP_REPO=/path npm run validate:pages
// theme.scss and tokens.scss are excluded: they are the token definitions (hex values and type roles,
// including letter-spacing in px), written once so that every other file can use var(--at-*) and role().
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const mcp = resolve(process.env.MCP_REPO || join(root, '..', 'design-system-mcp'))
const { validatePage } = await import(pathToFileURL(join(mcp, 'lib', 'validateRules.ts')).href)
const components = JSON.parse(readFileSync(join(mcp, 'registry', 'components.json'), 'utf8')).allowed.map((c) => c.name)

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
  const r = validatePage(readFileSync(join(root, file), 'utf8'), { allowedComponents: components })
  if (r.pass) console.log(`  pass  ${file}`)
  else {
    failed++
    console.log(`  FAIL  ${file}`)
    for (const v of r.violations) console.log(`          ${v.rule} (lines ${v.lines?.join(', ')}): ${v.message}`)
  }
}
console.log(`\n${files.length - failed} of ${files.length} files pass`)
process.exit(failed ? 1 : 0)
