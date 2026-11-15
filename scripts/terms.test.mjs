// Guards the product vocabulary (shared/terms.mjs): no sentence a person reads may hard-code the words approver, backup or approvals. They come from T, so a change of
// terminology is one edit. The scan reads real string literals, template parts and JSX text (not comments, identifiers, API paths or machine codes). A line that
// stores a word as data on purpose (an audit-log verb, say) carries `terms:ignore` on the line before it. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript5'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'dist'].includes(e.name)) walk(p, out) } else out.push(p)
  }
  return out
}
const files = ['src', 'server', 'shared']
  .flatMap((d) => walk(join(root, d)))
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.d\.(ts|mts)$/.test(f) && !/shared\/terms\./.test(f))

const WORD = /\b(approvers?|backups?|approvals)\b/i
const human = (t) => /\s/.test(t) || /^[A-Z]/.test(t) // a sentence or a label, not a key, path or code

/** Every place a person-readable text contains one of the words, as `file:line  text`. */
function offenders(file) {
  const src = readFileSync(file, 'utf8')
  if (!WORD.test(src)) return []
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind)
  const lines = src.split('\n')
  const out = []
  const check = (n, text) => {
    if (!WORD.test(text) || !human(text)) return
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line
    if (/terms:ignore/.test(lines[line - 1] ?? '') || /terms:ignore/.test(lines[line])) return
    out.push(`${relative(root, file)}:${line + 1}  ${text.trim().slice(0, 100)}`)
  }
  const visit = (n) => {
    const p = n.parent
    if (ts.isStringLiteral(n)) {
      const skip = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isElementAccessExpression(p) || ts.isPropertySignature(p) || (ts.isJsxAttribute(p) && /^(data-|className|id$|htmlFor|name$|kind|size|type$|href|to$|key$|value|role)/.test(p.name.getText()))
      if (!skip) check(n, n.text)
    } else if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) check(n, n.text)
    else if (ts.isJsxText(n)) check(n, n.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

test('no sentence or label hard-codes the words approver, backup or approvals: they come from shared/terms.mjs', () => {
  const found = files.flatMap(offenders)
  assert.deepEqual(found, [], `Use T (shared/terms.mjs) instead of the word, or put terms:ignore on the line before if it is stored data:\n${found.join('\n')}`)
})
