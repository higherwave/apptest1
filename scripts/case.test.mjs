// Guards the sentence-case rule: no label, heading, column header, button or tag is set in capitals, and nothing changes the case of text with CSS.
// Capitalise the first word and proper names in the text itself; an acronym stays as written. Applies to the app, the exports and the PDFs
// (the rule is also in the company registry, vendor/design-rules/tokens.json). Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'dist'].includes(e.name)) walk(p, out) } else out.push(p)
  }
  return out
}
const files = ['src', 'server', 'public', 'shared'].flatMap((d) => walk(join(root, d))).filter((f) => /\.(scss|css|ts|tsx|mjs|html)$/.test(f) && !/\.test\./.test(f))

test('no text-transform that changes the case of text (uppercase, capitalize, lowercase) in styles, exports or pages', () => {
  const found = []
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/text-transform\s*:\s*(uppercase|capitalize|lowercase)/i.test(line) && !/case:ignore/.test(line)) found.push(`${relative(root, f)}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(found, [], 'Use sentence case in the text itself instead of text-transform (see docs/STYLE-CHANGES.md)')
})
