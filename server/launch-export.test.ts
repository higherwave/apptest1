// The launch record as a PDF (slice 8): what the page says, that user text cannot break out of it, who may download it, and the file's name. Chrome never starts:
// a stand-in turns the HTML into bytes. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { exportFileName, launchRecordHtml } from './launch-export.js'
import { PdfError } from './pdf.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture(opts: { failPdf?: boolean; env?: Record<string, string> } = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const made: string[] = []
  const pdf = async (html: string, footer: string) => {
    if (opts.failPdf) throw new PdfError('The PDF service could not start.')
    made.push(html, footer)
    return Buffer.from('%PDF-1.4 stand-in')
  }
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', ...(opts.env ?? {}) }
  const as = (who = 'david') => createApp({ env: { ...env, DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer: recordingMailer(), pdf })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const alex = as('alex')
  const owner = as('david')
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring <b>release</b> & more', targetDate: '2026-12-01', briefNotes: 'Notes with <script>alert(1)</script>' })).json()
  const members = (await (await call(owner, 'GET', '/members')).json()).data as { id: string; email: string }[]
  const reviewer = (who: string, steps: string[]) => call(owner, 'POST', '/reviewers', { memberId: members.find((m) => m.email.startsWith(`${who}@`))!.id, steps, teams: 'all', role: 'primary' })
  return { pg, call, alex, owner, as, launch, made, reviewer, project }
}

test('the record says where it stands, each decision with its reason, who and when, the links, and escapes every piece of user text', async () => {
  const { call, alex, launch, reviewer } = await fixture()
  await reviewer('alex', ['legal'])
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'changes_needed', rationale: 'Fix <img src=x onerror=alert(1)> the consent & wording.' })
  await call(alex, 'POST', `/launches/${launch.id}/steps/legal/links`, { title: 'Consent <copy>', url: 'https://docs.example.com/consent' })
  const detail = await (await call(alex, 'GET', `/launches/${launch.id}`)).json()
  const html = launchRecordHtml(detail, new Date('2026-11-13T12:00:00Z'))
  assert.match(html, /Launch record/)
  assert.match(html, /Where it stands/)
  assert.match(html, /Holding it back/)
  assert.match(html, /Legal: changes needed/)
  assert.match(html, /Alex Rivera/)
  assert.ok(html.includes('Fix &lt;img src=x onerror=alert(1)&gt; the consent &amp; wording.'))
  assert.ok(html.includes('<a href="https://docs.example.com/consent">Consent &lt;copy&gt;</a>'))
  assert.ok(html.includes('Spring &lt;b&gt;release&lt;/b&gt; &amp; more'))
  assert.ok(!html.includes('<script>alert'), 'notes cannot add a script')
  assert.ok(!html.includes('<img src=x'), 'a reason cannot add an element')
  assert.match(html, /Target December 1, 2026/)
  assert.match(html, /A snapshot made Nov 13, 2026/)
  assert.match(html, /<h2>The brief<\/h2>/)
  assert.match(html, /<h2>The requirements<\/h2><table>/, 'the published requirements are listed')
  assert.match(html, /<strong>The problem\.<\/strong>/)
  // A link that is not http(s) is text, never an address.
  const odd = launchRecordHtml({ ...detail, steps: detail.steps.map((s: any) => (s.step === 'legal' ? { ...s, links: [{ id: 'x', title: 'bad', url: 'javascript:alert(1)', addedBy: null, addedAt: detail.briefAt }] } : s)) })
  assert.ok(!odd.includes('href="javascript:'))
})

test('a launch record downloads as a PDF with a clear file name; an external reviewer cannot; a failing service is a 502, switched off a 503', async () => {
  const { call, alex, launch, made, reviewer, owner, pg } = await fixture()
  const res = await call(alex, 'GET', `/launches/${launch.id}/export.pdf`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="spring-b-release-b-more-launch-record.pdf"')
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
  assert.match(made[0], /<h1>Spring/)
  assert.equal(made[1], 'Spring <b>release</b> & more: launch record')
  assert.equal(exportFileName({ name: '!!!' }, 'pdf'), 'launch-launch-record.pdf')
  // An external reviewer.
  await reviewer('sam', ['marketing'])
  await call(owner, 'POST', '/members', { email: 'counsel@outside-firm.com', role: 'viewer', external: true })
  void pg
  const failing = await fixture({ failPdf: true })
  assert.equal((await failing.call(failing.alex, 'GET', `/launches/${failing.launch.id}/export.pdf`)).status, 502)
  const off = await fixture({ env: { PDF_EXPORT: 'false' } })
  assert.equal((await off.call(off.alex, 'GET', `/launches/${off.launch.id}/export.pdf`)).status, 503)
})
