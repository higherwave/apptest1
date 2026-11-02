// Keeps a pinned copy of the design-system rules in vendor/design-rules/, so the linter runs with no sibling checkout
// (a fresh clone, CI, a new company's fork). The copy is four files from the design-system-mcp repo:
//   lib/validateRules.ts      the validator
//   registry/components.json  the allowlist of components
//   registry/tokens.json      the design tokens, as data
//   scripts/check-tokens.mjs  the drift check between tokens.json and src/theme.scss
// and vendor/design-rules/SOURCE.json records where they came from and a hash of each, so a hand edit is caught by the tests.
//
//   npm run rules:sync                       copy from ../design-system-mcp if it is checked out, else download from `repo` in SOURCE.json
//   npm run rules:sync -- --from /path       copy from this checkout
//   npm run rules:sync -- --ref v1.2.0       download that branch, tag or commit (default: the repo's main branch)
//   npm run rules:sync -- --repo owner/name  use another repository (written to SOURCE.json); GITHUB_TOKEN is used if set (private repos)
//   npm run rules:check                      compare the copy with upstream; exits 1 when they differ
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'vendor', 'design-rules')
const FILES = [
  { upstream: 'lib/validateRules.ts', local: 'validateRules.ts' },
  { upstream: 'registry/components.json', local: 'components.json' },
  { upstream: 'registry/tokens.json', local: 'tokens.json' },
  { upstream: 'scripts/check-tokens.mjs', local: 'check-tokens.mjs' },
]
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const check = args.includes('--check')
const current = existsSync(join(dir, 'SOURCE.json')) ? JSON.parse(readFileSync(join(dir, 'SOURCE.json'), 'utf8')) : {}
const repo = flag('--repo') || current.repo
const ref = flag('--ref') || current.ref || 'main'
const localCheckout = flag('--from') || process.env.MCP_REPO || (existsSync(resolve(root, '..', 'design-system-mcp', 'lib', 'validateRules.ts')) ? resolve(root, '..', 'design-system-mcp') : undefined)

async function fromCheckout(path) {
  const files = Object.fromEntries(FILES.map((f) => [f.local, readFileSync(join(path, f.upstream), 'utf8')]))
  let commit = 'unknown'
  try { commit = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* not a git checkout */ }
  return { files, commit, where: path }
}

async function fromGitHub(repo, ref) {
  if (!repo) throw new Error('No source: pass --from <checkout> or --repo owner/name (or keep "repo" in vendor/design-rules/SOURCE.json).')
  const headers = { 'user-agent': 'sync-design-rules', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }
  const get = async (url) => {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`${url} answered ${res.status}. For a private repo set GITHUB_TOKEN.`)
    return res
  }
  const commit = (await (await get(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`)).json()).sha
  const files = {}
  for (const f of FILES) files[f.local] = await (await get(`https://raw.githubusercontent.com/${repo}/${commit}/${f.upstream}`)).text()
  return { files, commit, where: `${repo}@${commit.slice(0, 7)}` }
}

const src = localCheckout && !flag('--repo') && !flag('--ref') ? await fromCheckout(localCheckout) : await fromGitHub(repo, ref)

if (check) {
  const drift = FILES.filter((f) => !existsSync(join(dir, f.local)) || readFileSync(join(dir, f.local), 'utf8') !== src.files[f.local]).map((f) => f.local)
  if (drift.length) {
    console.log(`Out of date with ${src.where}: ${drift.join(', ')}. Run: npm run rules:sync`)
    process.exit(1)
  }
  console.log(`Up to date with ${src.where}`)
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
for (const f of FILES) writeFileSync(join(dir, f.local), src.files[f.local])
const source = {
  repo: repo ?? current.repo ?? null,
  ref,
  commit: src.commit,
  files: Object.fromEntries(FILES.map((f) => [f.local, { from: f.upstream, sha256: sha256(src.files[f.local]) }])),
}
writeFileSync(join(dir, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n')
console.log(`Copied ${FILES.length} files from ${src.where} (commit ${String(src.commit).slice(0, 7)}) into vendor/design-rules/`)
