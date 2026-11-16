// The data export: complete, readable, free of secrets, and only ever the workspace that asked. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { aiUsageCsv, auditCsv, dataTables, exportWorkspace, toCsv } from './export.js'
import { crc32, safePath, zip } from './zip.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

// A reader for the archives we write: the end record, then the central directory, then each file inflated and its checksum checked.
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'an end-of-archive record')
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50)
    const crc = buf.readUInt32LE(at + 16)
    const packed = buf.readUInt32LE(at + 20)
    const raw = buf.readUInt32LE(at + 24)
    const nameLen = buf.readUInt16LE(at + 28)
    const offset = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const dataStart = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28)
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + packed))
    assert.equal(data.length, raw, `${name} size`)
    assert.equal(crc32(data), crc, `${name} checksum`)
    out.set(name, data)
    at += 46 + nameLen
  }
  return out
}

test('the archive writer makes a well-formed ZIP: names, contents and checksums survive, and a path cannot leave the archive', () => {
  const files = unzip(zip([{ path: 'a.txt', data: 'hello' }, { path: 'folder/ünï.json', data: Buffer.from('{"x":1}') }, { path: '../../etc/passwd', data: 'no' }, { path: '', data: 'empty name' }].slice(0, 3)))
  assert.deepEqual([...files.keys()], ['a.txt', 'folder/ünï.json', 'etc/passwd'])
  assert.equal(files.get('a.txt')!.toString(), 'hello')
  assert.equal(safePath('..\\..\\x/./y'), 'x/y')
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'the standard check value')
})

test('a spreadsheet cell that would run as a formula is made plain text, and quotes and line breaks are kept', () => {
  const csv = toCsv(['a', 'b'], [{ a: '=HYPERLINK("http://evil")', b: 'say "hi",\nthen go' }, { a: '+1', b: '@SUM(A1)' }, { a: null, b: new Date('2026-11-16T10:00:00Z') }])
  assert.equal(csv, `a,b\r\n"'=HYPERLINK(""http://evil"")","say ""hi"",\nthen go"\r\n'+1,'@SUM(A1)\r\n,2026-11-16T10:00:00.000Z\r\n`)
})

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const first = (await pg.query<any>(`select id, slug, name from core.workspaces where slug = 'higherwave-demo'`)).rows[0]
  await initWorkspace(pg, { name: 'Other Customer', slug: 'other', owners: ['owner@other.example.test'] })
  const other = (await pg.query<any>(`select id, slug, name from core.workspaces where slug = 'other'`)).rows[0]
  const team = (await pg.query<any>(`select id from core.teams where workspace_id = $1 and is_default`, [other.id])).rows[0].id
  const project = (await pg.query<any>(`insert into core.projects (workspace_id, name, kind, team_id) values ($1, 'Zebra Crossing Study', 'research', $2) returning id`, [other.id, team])).rows[0].id
  const transcript = (await pg.query<any>(`insert into research.transcripts (workspace_id, project_id, name, platform, raw_text, content_hash, position) values ($1, $2, 'Call with Zed', 'zoom', 'raw', 'h', 1) returning id`, [other.id, project])).rows[0].id
  const speaker = (await pg.query<any>(`insert into research.transcript_speakers (workspace_id, transcript_id, name, role) values ($1, $2, 'Zed', 'participant') returning id`, [other.id, transcript])).rows[0].id
  await pg.query(`insert into research.utterances (workspace_id, transcript_id, speaker_id, position, text) values ($1, $2, $3, 1, 'Quokka-7731 said the crossing was confusing.')`, [other.id, transcript, speaker])
  return { pg, db, first, other }
}
const allText = (files: Map<string, Buffer>) => [...files.values()].map((b) => b.toString('utf8')).join('\n')

test('an export holds every table of the workspace, readable files for people, and a manifest that matches the database', async () => {
  const f = await fixture()
  const out = await exportWorkspace(f.db.inWorkspace(f.first.id), f.first)
  const files = unzip(out.bytes)
  const names = [...files.keys()]
  // Every table that carries a workspace id is there, whole: a new table is exported without anyone remembering it.
  for (const t of await dataTables(f.pg as any)) assert.ok(names.includes(`data/${t.schema}.${t.name}.json`), `${t.schema}.${t.name}`)
  assert.ok(names.includes('README.txt') && names.includes('manifest.json') && names.includes('audit-log.csv') && names.includes('ai-usage.csv') && names.includes('data/members.json'))
  const manifest = JSON.parse(files.get('manifest.json')!.toString())
  assert.equal(manifest.secretsIncluded, false)
  for (const [table, n] of Object.entries<number>(manifest.rows)) {
    if (table === 'members') continue
    const real = (await f.pg.query<any>(`select count(*)::int n from ${table} where workspace_id = $1`, [f.first.id])).rows[0].n
    assert.equal(n, real, `${table} row count`)
    assert.equal(JSON.parse(files.get(`data/${table}.json`)!.toString()).length, real, `${table} file`)
  }
  assert.ok(manifest.rows['research.utterances'] > 50, 'the transcripts are really in it')
  // Readable files: a project's plan, a transcript, its themes with quotes, requirements and a launch.
  const readable = names.filter((n) => n.startsWith('projects/'))
  assert.ok(readable.some((n) => n.endsWith('/overview.md')))
  assert.ok(readable.some((n) => /\/transcripts\/01-.*\.txt$/.test(n)))
  assert.ok(readable.some((n) => n.endsWith('/themes.md')))
  assert.ok(readable.some((n) => n.endsWith('/requirements.md')))
  assert.ok(readable.some((n) => /\/launch-.*\.md$/.test(n)), 'the Anchor CX launch with its answers')
  const themes = files.get(readable.find((n) => n.endsWith('/themes.md'))!)!.toString()
  assert.match(themes, /^> /m, 'quotes are in the themes file')
})

test('Slack and Jira tokens are never in an export, not even encrypted', async () => {
  const f = await fixture()
  await f.pg.query(`insert into core.workspace_integrations (workspace_id, kind, config, secret_enc) values ($1, 'slack', '{"team":"T1"}', 'v1.SECRETIV.SECRETTAG.SECRETBODY')`, [f.first.id])
  const files = unzip((await exportWorkspace(f.db.inWorkspace(f.first.id), f.first)).bytes)
  const rows = JSON.parse(files.get('data/core.workspace_integrations.json')!.toString())
  assert.equal(rows.length, 1)
  assert.ok(!('secret_enc' in rows[0]), 'the column is left out')
  assert.ok(!allText(files).includes('SECRETBODY'))
  assert.equal(rows[0].config.team, 'T1', 'what is not secret stays')
})

test('an export holds nothing of another workspace, in either direction', async () => {
  const f = await fixture()
  const mine = unzip((await exportWorkspace(f.db.inWorkspace(f.first.id), f.first)).bytes)
  const theirs = unzip((await exportWorkspace(f.db.inWorkspace(f.other.id), f.other)).bytes)
  const myText = allText(mine)
  const theirText = allText(theirs)
  // The other customer's words and names are not in mine...
  for (const needle of ['Zebra Crossing Study', 'Quokka-7731', 'owner@other.example.test', 'Other Customer', f.other.id]) assert.ok(!myText.includes(needle), `my export has ${needle}`)
  assert.ok(theirText.includes('Quokka-7731'), 'but they are in theirs (the check can find what it looks for)')
  assert.ok(theirText.includes('owner@other.example.test'))
  // ...and the first customer's are not in theirs.
  const projectNames = (await f.pg.query<any>(`select name from core.projects where workspace_id = $1`, [f.first.id])).rows.map((r) => String(r.name))
  assert.ok(projectNames.length >= 3)
  for (const needle of [...projectNames, f.first.id, 'david@demo.signalflow.example']) assert.ok(!theirText.includes(needle), `their export has ${needle}`)
  assert.equal(theirs.size < mine.size, true)
})

test('the audit log and the AI usage come out as spreadsheets for that workspace only', async () => {
  const f = await fixture()
  await f.pg.query(`insert into core.ai_usage (workspace_id, purpose, provider, model, input_tokens, output_tokens, cost_usd, inference_geo) values ($1, 'analysis', 'anthropic', 'claude-sonnet-5-5', 10, 5, 0.044, 'us'), ($2, 'analysis', 'anthropic', 'claude-sonnet-5-5', 1, 1, 9.99, 'global')`, [f.first.id, f.other.id])
  const usage = await aiUsageCsv(f.db.inWorkspace(f.first.id), f.first.id)
  assert.match(usage, /^created_at,purpose,provider,model,input_tokens,output_tokens,cost_usd,inference_geo,run_id\r\n/)
  assert.ok(usage.includes('0.044') && usage.includes(',us,'), 'its own call, with where it ran')
  assert.ok(!usage.includes('9.99'), 'not the other workspace’s')
  const audit = await auditCsv(f.db.inWorkspace(f.first.id), f.first.id)
  assert.match(audit, /^created_at,actor,actor_email,entity,entity_id,verb,before,after\r\n/)
})

test('only an owner can download, every download is recorded, and an external person or a viewer is refused', async () => {
  const f = await fixture()
  const app = (email: string, slug = 'higherwave-demo') => createApp({ env: { DEV_TOKEN: 's3cret', WORKSPACE_SLUG: slug, DEV_USER_EMAIL: email }, getDb: () => f.db })
  const get = (a: ReturnType<typeof app>, path: string) => a.request(`/api/v1${path}`, { headers: { authorization: 'Bearer s3cret' } })
  const owner = app('david@demo.signalflow.example')
  for (const path of ['/export/workspace.zip', '/export/audit.csv', '/export/ai-usage.csv']) {
    const res = await get(owner, path)
    assert.equal(res.status, 200, path)
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="/)
    assert.equal(res.headers.get('cache-control'), 'private, no-store')
  }
  const zipRes = await get(owner, '/export/workspace.zip')
  assert.equal(zipRes.headers.get('content-type'), 'application/zip')
  assert.ok(unzip(Buffer.from(await zipRes.arrayBuffer())).has('manifest.json'))
  for (const who of ['alex', 'sam']) {
    const res = await get(app(`${who}@demo.signalflow.example`), '/export/workspace.zip')
    assert.equal(res.status, 403, `${who} is not an owner`)
  }
  assert.equal((await owner.request('/api/v1/export/workspace.zip')).status, 401, 'no sign-in, no download')
  const recorded = (await f.pg.query<any>(`select verb, after from core.audit_log where entity = 'core.workspaces' and verb = 'exported' order by created_at`)).rows
  assert.ok(recorded.length >= 4, `${recorded.length} downloads recorded`)
  assert.deepEqual(new Set(recorded.map((r) => (typeof r.after === 'string' ? JSON.parse(r.after) : r.after).what)), new Set(['all workspace data', 'audit log', 'AI usage']))
})
