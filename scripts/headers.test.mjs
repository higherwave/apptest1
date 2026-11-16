// The security headers in vercel.json: they exist, and the content security policy allows exactly the one inline script the landing page has.
// If public/landing.html's inline script changes, its hash changes and this fails: update the hash in vercel.json (and nothing else).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const headers = Object.fromEntries((config.headers?.find((h) => h.source === '/(.*)')?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]))

test('every page and answer carries the security headers', () => {
  for (const name of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']) {
    assert.ok(headers[name], `${name} is missing from vercel.json`)
  }
  assert.equal(headers['x-content-type-options'], 'nosniff')
  assert.equal(headers['x-frame-options'], 'DENY')
})

test('the content security policy refuses everything it does not need', () => {
  const policy = Object.fromEntries(headers['content-security-policy'].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
  assert.deepEqual(policy['default-src'], ["'self'"])
  assert.ok(!policy['script-src'].includes("'unsafe-inline'") && !policy['script-src'].includes("'unsafe-eval'"), 'no inline or eval scripts')
  assert.deepEqual(policy['object-src'], ["'none'"])
  assert.deepEqual(policy['frame-ancestors'], ["'none'"])
  assert.deepEqual(policy['connect-src'], ["'self'"], 'the app talks only to itself')
  assert.deepEqual(policy['base-uri'], ["'self'"])
})

test('the landing page’s one inline script is allowed by hash, and it is the only one', () => {
  const html = readFileSync(join(root, 'public', 'landing.html'), 'utf8')
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.equal(inline.length, 1, 'a second inline script would need its own hash')
  const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`
  assert.ok(headers['content-security-policy'].includes(hash), `the policy does not allow the landing page's inline script: add ${hash} to script-src in vercel.json`)
  for (const page of ['about.html', 'privacy.html']) {
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(readFileSync(join(root, 'public', page), 'utf8')), `${page} has an inline script`)
  }
})
