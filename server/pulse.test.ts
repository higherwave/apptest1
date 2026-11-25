// Pulse (preview, slice 1): owners only and only while an owner has switched it on; customer signals added by hand or split out of notes, then kept or dismissed.
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { runPulseUpdates, splitNotes } from './pulse.js'
import { fillDemoSignals, SAMPLES } from '../scripts/demo-pulse-signals.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const WHY = { reason: 'not_relevant' }

// The demo has David (owner), Alex (editor) and Sam (viewer). Each request is made as one person, with a new app so the identity cache never carries over.
async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  const as = (who?: string) => createApp({ env: { DEV_TOKEN: 's3cret', ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { pg, db, as, call, owner: as(), alex: as('alex'), sam: as('sam') }
}

test('Pulse is off until an owner switches it on; then owners and editors use it, a granted viewer only sees it, and everyone else gets "not found"', async () => {
  const { call, owner, alex, sam, pg } = await fixture()
  assert.equal((await (await call(owner, 'GET', '/me')).json()).features.pulse, false, 'off by default')
  assert.equal((await call(owner, 'GET', '/pulse/signals')).status, 404, 'off: even the owner gets "not found"')
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: 'x' })).status, 404)
  assert.deepEqual(await (await call(owner, 'GET', '/pulse/preview')).json(), { enabled: false })

  assert.equal((await call(alex, 'PUT', '/pulse/preview', { enabled: true })).status, 403, 'an editor cannot switch it on')
  assert.equal((await call(sam, 'PUT', '/pulse/preview', { enabled: true })).status, 403, 'neither can a viewer')
  assert.equal((await call(alex, 'GET', '/pulse/preview')).status, 403)
  assert.equal((await call(owner, 'PUT', '/pulse/preview', { enabled: 'yes' })).status, 422)

  assert.deepEqual(await (await call(owner, 'PUT', '/pulse/preview', { enabled: true })).json(), { enabled: true })
  assert.deepEqual((await (await call(owner, 'GET', '/me')).json()).features, { pulse: true, pulseEdit: true })
  assert.equal((await call(owner, 'GET', '/pulse/signals')).status, 200)

  // An editor (platform editor) can use Pulse and change what is in it, but not its settings.
  assert.deepEqual((await (await call(alex, 'GET', '/me')).json()).features, { pulse: true, pulseEdit: true })
  assert.equal((await call(alex, 'GET', '/pulse/signals')).status, 200)
  assert.equal((await call(alex, 'POST', '/pulse/signals', { body: 'An editor adds a signal about handoffs.' })).status, 201)
  for (const [m, path, body] of [['PUT', '/pulse/weights', { weights: { slack: 1 } }], ['GET', '/pulse/sources', undefined], ['GET', '/pulse/salesforce', undefined], ['GET', '/pulse/viewers', undefined], ['POST', '/pulse/sources', { name: 'feedback' }]] as const) {
    assert.equal((await call(alex, m, path, body)).status, 403, `${m} ${path} is the owner's`)
  }

  // A viewer sees nothing until an owner grants view; the grant is view only.
  const samId = (await (await call(sam, 'GET', '/me')).json()).userId
  assert.deepEqual((await (await call(sam, 'GET', '/me')).json()).features, { pulse: false, pulseEdit: false })
  for (const [m, path, body] of [['GET', '/pulse/signals', undefined], ['GET', '/pulse/topics', undefined], ['POST', '/pulse/signals', { body: 'x' }], ['POST', '/pulse/signals/import', { text: 'x' }], ['PATCH', '/pulse/signals/00000000-0000-0000-0000-000000000000', { status: 'kept' }]] as const) {
    assert.equal((await call(sam, m, path, body)).status, 404, `${m} ${path}: not found for a viewer with no grant`)
  }
  assert.equal((await call(sam, 'PUT', `/pulse/viewers/${samId}`, { canView: true })).status, 404, 'a viewer cannot grant themselves (and cannot tell it exists)')
  assert.equal((await call(alex, 'PUT', `/pulse/viewers/${samId}`, { canView: true })).status, 403, 'neither can an editor')
  const viewers = await (await call(owner, 'GET', '/pulse/viewers')).json()
  assert.ok(viewers.members.find((m: any) => m.email.startsWith('david')).always && !viewers.members.find((m: any) => m.userId === samId).canView)
  const granted = await (await call(owner, 'PUT', `/pulse/viewers/${samId}`, { canView: true })).json()
  assert.ok(granted.members.find((m: any) => m.userId === samId).canView)
  assert.deepEqual((await (await call(sam, 'GET', '/me')).json()).features, { pulse: true, pulseEdit: false })
  for (const path of ['/pulse/signals', '/pulse/topics', '/pulse/weights']) assert.equal((await call(sam, 'GET', path)).status, 200, `a granted viewer can read ${path}`)
  for (const [m, path, body] of [['POST', '/pulse/signals', { body: 'A viewer cannot add this.' }], ['POST', '/pulse/signals/import', { text: 'A viewer cannot import this either.' }], ['PATCH', '/pulse/signals/00000000-0000-0000-0000-000000000000', { status: 'kept' }], ['POST', '/pulse/topics/update', {}], ['POST', '/pulse/questions', { topicIds: ['00000000-0000-0000-0000-000000000000'] }], ['PUT', '/pulse/weights', { weights: { slack: 1 } }], ['GET', '/pulse/sources', undefined], ['GET', '/pulse/viewers', undefined]] as const) {
    assert.equal((await call(sam, m, path, body)).status, 403, `${m} ${path}: a granted viewer cannot change anything`)
  }
  assert.equal((await call(owner, 'PUT', `/pulse/viewers/${(await (await call(alex, 'GET', '/me')).json()).userId}`, { canView: true })).status, 422, 'owners and editors always have access; nothing to grant')
  assert.equal((await call(owner, 'PUT', `/pulse/viewers/${samId}`, { canView: false })).status, 200)
  assert.equal((await call(sam, 'GET', '/pulse/signals')).status, 404, 'taking it away is immediate')

  // The read-only demo visitor (no token) never sees it either.
  assert.equal((await owner.request('/api/v1/pulse/signals')).status, 404)

  await call(owner, 'PUT', '/pulse/preview', { enabled: false })
  assert.equal((await call(owner, 'GET', '/pulse/signals')).status, 404, 'switched off again')
  assert.equal((await call(alex, 'GET', '/pulse/signals')).status, 404, 'and off for editors too')
  const audit = (await pg.query<any>(`select verb from core.audit_log where entity = 'core.workspace_features' order by created_at`)).rows.map((r: any) => r.verb)
  assert.deepEqual(audit, ['turned on', 'turned off'], 'the switch is audited')
  assert.deepEqual((await pg.query<any>(`select verb from core.audit_log where entity = 'core.pulse_viewers' order by created_at`)).rows.map((r: any) => r.verb), ['granted view', 'removed view'], 'grants are audited')
})

test('signals: typed in or split out of notes, all kept at once, then dismissed or put back; bad input is refused', async () => {
  const { call, owner } = await fixture()
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })

  const made = await call(owner, 'POST', '/pulse/signals', { body: '  Our CSMs do not trust the health score.  ', kind: 'complaint', saidBy: 'Marcus', account: 'Northwind', sourceLabel: 'Renewal call', occurredOn: '2026-11-18' })
  assert.equal(made.status, 201)
  const first = await made.json()
  assert.deepEqual([first.body, first.kind, first.source, first.status, first.saidBy, first.account, first.occurredOn], ['Our CSMs do not trust the health score.', 'complaint', 'manual', 'kept', 'Marcus', 'Northwind', '2026-11-18'])
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: '   ' })).status, 422, 'an empty signal is refused')
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: 'x', sourceUrl: 'javascript:alert(1)' })).status, 422, 'only http and https links')
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: 'x', occurredOn: '18/11/2026' })).status, 422, 'a date has to be a date')

  const imported = await call(owner, 'POST', '/pulse/signals/import', { text: '- Reports take too long to build by hand.\n- Handoffs to support lose context.\n- ok', sourceLabel: 'Call notes', account: 'Contoso' })
  assert.equal(imported.status, 201)
  assert.deepEqual(await imported.json(), { created: 2, skipped: 0, duplicates: 0 }, 'bullets are dropped, and a fragment too short to be a signal is left out')
  const list = await (await call(owner, 'GET', '/pulse/signals')).json()
  assert.deepEqual(list.counts, { new: 0, kept: 3, dismissed: 0 }, 'nothing waits for review')
  const fromNotes = list.signals.filter((s: any) => s.source === 'notes')
  assert.deepEqual([fromNotes.length, fromNotes[0].status, fromNotes[0].sourceLabel, fromNotes[0].account], [2, 'kept', 'Call notes', 'Contoso'])

  const dismissed = await call(owner, 'PATCH', `/pulse/signals/${fromNotes[0].id}`, { status: 'dismissed' })
  assert.equal((await dismissed.json()).status, 'dismissed')
  await call(owner, 'PATCH', `/pulse/signals/${fromNotes[1].id}`, { status: 'kept', kind: 'request' })
  const after = await (await call(owner, 'GET', '/pulse/signals')).json()
  assert.deepEqual(after.counts, { new: 0, kept: 2, dismissed: 1 })
  assert.equal((await (await call(owner, 'GET', '/pulse/signals?status=dismissed')).json()).signals.length, 1)
  assert.equal((await call(owner, 'GET', '/pulse/signals?status=bogus')).status, 422)
  assert.equal((await call(owner, 'PATCH', `/pulse/signals/${first.id}`, {})).status, 422, 'a change has to say what')
  assert.equal((await call(owner, 'PATCH', '/pulse/signals/not-an-id', { status: 'kept' })).status, 404)
})

test('notes are split by paragraph, or by line when there are no blank lines, and numbering is dropped', () => {
  assert.deepEqual(splitNotes('First point that is long enough.\nStill the same point.\n\nSecond point that is long enough.'), ['First point that is long enough. Still the same point.', 'Second point that is long enough.'])
  assert.deepEqual(splitNotes('1. One thing customers asked for.\n2) Another thing customers asked for.'), ['One thing customers asked for.', 'Another thing customers asked for.'])
  assert.deepEqual(splitNotes('   \n  '), [])
  assert.deepEqual(splitNotes('short'), [])
})

test('the sample-signals script fills Pulse with the Anchor CX story, and is safe to repeat', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  const dry = await fillDemoSignals(db, slug, false)
  assert.equal(dry.added, 0)
  assert.equal(((await pg.query<any>('select count(*)::int as n from core.pulse_signals')).rows[0] as { n: number }).n, 0, 'a dry run writes nothing')
  const run = await fillDemoSignals(db, slug, true)
  assert.equal(run.added, SAMPLES.length)
  const by = (await pg.query<any>(`select source, status, count(*)::int as n from core.pulse_signals group by 1, 2 order by 1, 2`)).rows
  assert.ok(by.every((r: any) => r.status === 'kept'), 'nothing waits for review: every sample counts at once')
  assert.ok(by.some((r: any) => r.source === 'notes' && r.status === 'kept'))
  assert.equal((await fillDemoSignals(db, slug, true)).added, 0, 'a second run adds nothing')
})


test('topics: updating groups the kept signals, ranks them by weighted score, and re-ranks when an owner changes a weight', async () => {
  const { call, owner, alex, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)

  const before = await (await call(owner, 'GET', '/pulse/topics')).json()
  assert.deepEqual([before.topics.length, before.updatedAt, before.unsorted, before.toReview], [0, null, 17, 0], 'nothing is grouped until topics are updated')

  const res = await call(owner, 'POST', '/pulse/topics/update', {})
  assert.equal(res.status, 200)
  const list = await res.json()
  assert.deepEqual(list.topics.map((t: any) => [t.title, t.signals]), [['Trust and accuracy', 6], ['Reporting and digests', 5], ['Handoffs and lost context', 3], ['Renewal preparation', 2]])
  assert.deepEqual([list.unsorted, list.toReview, list.sinceUpdate, typeof list.updatedAt], [1, 0, 0, 'string'], 'the praise fits no topic')
  const trust = list.topics[0]
  assert.equal(trust.rank, 1)
  assert.equal(trust.score, Math.round(trust.breakdown.reduce((a: number, b: any) => a + b.subtotal, 0) * 100) / 100, 'the score is the breakdown summed')
  assert.ok(trust.breakdown.every((b: any) => b.subtotal === Math.round(b.count * b.weight * 100) / 100))
  assert.ok(trust.channelCount === 2 && trust.reach >= 3, 'heard in both channels')

  // Weights: boosting Slack changes every score at once, with no update, and the list stays in score order.
  assert.deepEqual((await (await call(owner, 'GET', '/pulse/weights')).json()).weights, { call_notes: 1, salesforce: 0.8, slack: 0.5, support_tickets: 0.8 })
  const put = await call(owner, 'PUT', '/pulse/weights', { weights: { slack: 5 } })
  assert.equal(put.status, 200)
  const reranked = await (await call(owner, 'GET', '/pulse/topics')).json()
  assert.deepEqual(reranked.topics.map((t: any) => [t.title, t.score]), [['Trust and accuracy', 18], ['Reporting and digests', 13], ['Handoffs and lost context', 7], ['Renewal preparation', 6]], 'three call notes at 1 plus three Slack signals at 5, and so on')
  assert.ok(reranked.topics.every((t: any, i: number, all: any[]) => i === 0 || all[i - 1].score >= t.score))
  assert.equal((await call(owner, 'PUT', '/pulse/weights', { weights: { slack: 9 } })).status, 422, 'a weight is at most 5')
  assert.equal((await call(owner, 'PUT', '/pulse/weights', { weights: { email: 1 } })).status, 422, 'only the known channels')
  assert.equal((await call(owner, 'PUT', '/pulse/weights', { weights: {} })).status, 422)
  const audit = (await pg.query<any>(`select verb from core.audit_log where entity = 'core.pulse_weights'`)).rows
  assert.equal(audit.length, 1, 'a weight change is audited')
  assert.equal((await call(alex, 'GET', '/pulse/topics')).status, 200, 'an editor sees topics')
  assert.equal((await call(alex, 'POST', '/pulse/topics/update', {})).status, 200, 'and updates them')
  assert.equal((await call(alex, 'GET', '/pulse/weights')).status, 200)
  assert.equal((await call(alex, 'PUT', '/pulse/weights', { weights: { slack: 1 } })).status, 403, 'but weights are the owner\'s')
})

test('topics: a person can rename, merge and split, and what they touch survives the regrouping', async () => {
  const { call, owner, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  let list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  const id = (title: string) => list.topics.find((t: any) => t.title === title).id as string

  list = await (await call(owner, 'PATCH', `/pulse/topics/${id('Trust and accuracy')}`, { title: 'Why the health score moves' })).json()
  assert.deepEqual(list.topics.map((t: any) => [t.title, t.edited]).find(([t]: any) => t === 'Why the health score moves'), ['Why the health score moves', true])
  assert.equal((await call(owner, 'PATCH', `/pulse/topics/${id('Renewal preparation')}`, { title: '  ' })).status, 422)
  assert.equal((await call(owner, 'PATCH', '/pulse/topics/00000000-0000-0000-0000-000000000000', { title: 'x' })).status, 404)

  // Merge Renewal preparation into Reporting: five signals there, one topic fewer, and the target counts as edited.
  list = await (await call(owner, 'POST', `/pulse/topics/${id('Renewal preparation')}/merge`, { intoId: id('Reporting and digests') })).json()
  assert.deepEqual([list.topics.length, list.topics.find((t: any) => t.title === 'Reporting and digests').signals, list.topics.find((t: any) => t.title === 'Reporting and digests').edited], [3, 7, true])
  assert.equal((await call(owner, 'POST', `/pulse/topics/${id('Reporting and digests')}/merge`, { intoId: id('Reporting and digests') })).status, 422, 'not into itself')

  // Split two signals out of Handoffs; at least one has to stay.
  const handoffSignals = (await pg.query<any>(`select s.id from core.pulse_topic_signals ts join core.pulse_signals s on s.id = ts.signal_id where ts.topic_id = $1 order by s.created_at, s.id`, [id('Handoffs and lost context')])).rows.map((r: any) => r.id)
  assert.equal((await call(owner, 'POST', `/pulse/topics/${id('Handoffs and lost context')}/split`, { signalIds: handoffSignals, title: 'All of it' })).status, 422, 'something must stay behind')
  list = await (await call(owner, 'POST', `/pulse/topics/${id('Handoffs and lost context')}/split`, { signalIds: handoffSignals.slice(0, 1), title: 'Context for support' })).json()
  assert.deepEqual(list.topics.filter((t: any) => ['Context for support', 'Handoffs and lost context'].includes(t.title)).map((t: any) => t.signals).sort(), [1, 2])

  // The daily regrouping leaves every topic a person touched exactly as it is.
  const touched = list.topics.map((t: any) => [t.title, t.signals])
  list = await (await call(owner, 'POST', '/pulse/topics/update', { mode: 'regroup' })).json()
  assert.deepEqual(list.topics.map((t: any) => [t.title, t.signals]).sort(), touched.sort())
})

test('topics: a signal that is no longer kept leaves its topic, and a new one joins the topic it fits when topics next update', async () => {
  const { call, owner, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  let list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  const trustCount = list.topics.find((t: any) => t.title === 'Trust and accuracy').signals

  // Add a signal about the score: nothing moves until the next update.
  const added = await (await call(owner, 'POST', '/pulse/signals', { body: 'Nobody can explain why the score keeps changing.', channel: 'call_notes', saidBy: 'Pat', account: 'Initech' })).json()
  assert.equal(added.channel, 'call_notes')
  list = await (await call(owner, 'GET', '/pulse/topics')).json()
  assert.equal(list.topics.find((t: any) => t.title === 'Trust and accuracy').signals, trustCount, 'rankings do not shift while a page is read')
  assert.equal(list.sinceUpdate, 1)

  list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  assert.equal(list.topics.find((t: any) => t.title === 'Trust and accuracy').signals, trustCount + 1, 'it joined the existing topic')
  assert.equal(list.sinceUpdate, 0)

  const first = (await pg.query<any>(`select s.id from core.pulse_topic_signals ts join core.pulse_signals s on s.id = ts.signal_id join core.pulse_topics t on t.id = ts.topic_id where t.title = 'Trust and accuracy' limit 1`)).rows[0].id
  await call(owner, 'PATCH', `/pulse/signals/${first}`, { status: 'dismissed' })
  list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  assert.equal(list.topics.find((t: any) => t.title === 'Trust and accuracy').signals, trustCount, 'a dismissed signal leaves its topic')
})

test('the scheduled job updates the topics of every workspace that has Pulse on, and no other', async () => {
  const { call, owner, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await fillDemoSignals(db, slug, true)
  assert.deepEqual(await runPulseUpdates(db), { workspaces: 0, regrouped: 0, read: 0 }, 'off: nothing happens')
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  assert.deepEqual(await runPulseUpdates(db), { workspaces: 1, regrouped: 1, read: 0 }, 'the first run regroups')
  assert.equal((await (await call(owner, 'GET', '/pulse/topics')).json()).topics.length, 4)
  assert.deepEqual(await runPulseUpdates(db), { workspaces: 1, regrouped: 0, read: 0 }, 'the next hour only attaches')
})


test('topic details, suggested questions, and starting a Signal Flow project from topics', async () => {
  const { call, owner, alex, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  const list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  const trust = list.topics.find((t: any) => t.title === 'Trust and accuracy')
  const reporting = list.topics.find((t: any) => t.title === 'Reporting and digests')

  // Details: the quotes behind the topic, newest first, with who and where; the accounts and people.
  const detail = await (await call(owner, 'GET', `/pulse/topics/${trust.id}`)).json()
  assert.equal(detail.quotes.length, trust.signals)
  assert.ok(detail.quotes.every((q: any) => q.body && q.channel))
  assert.deepEqual(detail.quotes.map((q: any) => q.occurredOn), [...detail.quotes.map((q: any) => q.occurredOn)].sort().reverse(), 'newest first')
  assert.ok(detail.accounts.length >= 3 && detail.accounts.every((a: any) => a.name !== 'Unknown'))
  assert.equal(detail.score, trust.score, 'the same numbers as the list')
  assert.equal((await call(owner, 'GET', '/pulse/topics/00000000-0000-0000-0000-000000000000')).status, 404)
  assert.equal((await call(alex, 'GET', `/pulse/topics/${trust.id}`)).status, 200, 'an editor can open a topic')

  // Questions: grounded in the topics' own signals.
  const asked = await call(owner, 'POST', '/pulse/questions', { topicIds: [trust.id, reporting.id], method: 'Contextual (walk-through)' })
  assert.equal(asked.status, 200)
  const questions = (await asked.json()).questions
  assert.ok(questions.length >= 4 && questions.length <= 6)
  const quotes = new Set([...detail.quotes.map((q: any) => q.body), ...(await (await call(owner, 'GET', `/pulse/topics/${reporting.id}`)).json()).quotes.map((q: any) => q.body)])
  assert.ok(questions.filter((q: any) => q.evidence).every((q: any) => quotes.has(q.evidence.quote)), 'every piece of evidence is a real signal, verbatim')
  assert.equal((await call(owner, 'POST', '/pulse/questions', { topicIds: [] })).status, 422)
  assert.equal((await call(owner, 'POST', '/pulse/questions', { topicIds: ['00000000-0000-0000-0000-000000000000'] })).status, 404)
  assert.equal((await call(alex, 'POST', '/pulse/questions', { topicIds: [trust.id] })).status, 200, 'an editor can draft questions')

  // Starting the project: the Test Plan is filled in, and the project remembers where it came from.
  const body = { name: 'Trust and reporting', description: 'Frame the problem around trust in the score and manual reporting.', methods: ['Contextual (walk-through)'], topicIds: [trust.id, reporting.id], questions: questions.slice(0, 4).map((q: any) => ({ prompt: q.prompt, topicId: q.topicId })) }
  const made = await call(owner, 'POST', '/pulse/projects', body)
  assert.equal(made.status, 201)
  const { projectId } = await made.json()
  const project = await (await call(owner, 'GET', `/projects/${projectId}`)).json()
  assert.deepEqual([project.name, project.description, project.methods, project.participants.length], ['Trust and reporting', body.description, ['Contextual (walk-through)'], 0])
  assert.deepEqual(project.tasks.map((t: any) => t.prompt), body.questions.map((q: any) => q.prompt), 'the questions are the Test Plan\'s "What to ask or observe", in order')
  assert.ok((await (await call(owner, 'GET', '/projects')).json()).data.some((p: any) => p.id === projectId), 'it is in the project list')
  const origin = await (await call(owner, 'GET', `/pulse/origin/${projectId}`)).json()
  assert.deepEqual(origin.topics.map((t: any) => t.title).sort(), ['Reporting and digests', 'Trust and accuracy'])
  assert.equal(origin.signals, trust.signals + reporting.signals)
  assert.equal((await call(owner, 'GET', `/pulse/origin/00000000-0000-4000-8000-000000000000`)).status, 404, 'a project not started from Pulse has no origin')
  assert.equal((await call(alex, 'GET', `/pulse/origin/${projectId}`)).status, 200, 'and sees where a project came from')
  const audit = (await pg.query<any>(`select verb from core.audit_log where entity = 'core.pulse_project_links'`)).rows
  assert.equal(audit.length, 1)

  // A merge afterwards does not rewrite what the project started from.
  await call(owner, 'POST', `/pulse/topics/${reporting.id}/merge`, { intoId: trust.id })
  assert.deepEqual((await (await call(owner, 'GET', `/pulse/origin/${projectId}`)).json()).topics.map((t: any) => t.title).sort(), ['Reporting and digests', 'Trust and accuracy'])
  assert.equal((await call(owner, 'POST', '/pulse/projects', { ...body, name: '' })).status, 422)
  assert.equal((await call(owner, 'POST', '/pulse/projects', { ...body, topicIds: [reporting.id] })).status, 404, 'a merged topic can no longer start one')
})

test('topics: a person dismisses a whole topic; it stays hidden through updates until three new signals have joined it', async () => {
  const { call, owner, alex, sam, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  let list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  const reporting = list.topics.find((t: any) => t.title === 'Reporting and digests')
  const before = list.topics.length

  assert.equal((await call(sam, 'POST', `/pulse/topics/${reporting.id}/dismiss`, WHY)).status, 404, 'someone without access cannot tell it exists')
  await call(owner, 'PUT', `/pulse/viewers/${(await (await call(sam, 'GET', '/me')).json()).userId}`, { canView: true })
  assert.equal((await call(sam, 'POST', `/pulse/topics/${reporting.id}/dismiss`, WHY)).status, 403, 'a viewer cannot dismiss')
  assert.equal((await call(owner, 'POST', '/pulse/topics/00000000-0000-0000-0000-000000000000/dismiss', WHY)).status, 404)
  // A reason is required, "other" needs a comment, and nothing is dismissed by a refused request.
  assert.equal((await call(alex, 'POST', `/pulse/topics/${reporting.id}/dismiss`, {})).status, 422, 'a reason is required')
  assert.equal((await call(alex, 'POST', `/pulse/topics/${reporting.id}/dismiss`, { reason: 'because' })).status, 422, 'from the list')
  assert.equal((await call(alex, 'POST', `/pulse/topics/${reporting.id}/dismiss`, { reason: 'other' })).status, 422, 'other needs a comment')
  assert.equal((await call(alex, 'POST', `/pulse/topics/${reporting.id}/dismiss`, { reason: 'other', comment: '   ' })).status, 422)
  assert.equal((await (await call(owner, 'GET', '/pulse/topics')).json()).topics.length, before, 'still all there')
  list = await (await call(alex, 'POST', `/pulse/topics/${reporting.id}/dismiss`, { reason: 'addressed', comment: 'Shipped in the November release.' })).json()
  assert.equal(list.topics.length, before - 1, 'an editor can dismiss it, and it leaves the list')
  assert.equal((await call(owner, 'POST', `/pulse/topics/${reporting.id}/dismiss`, WHY)).status, 404, 'already dismissed')
  const audit = (await pg.query<any>(`select verb, after from core.audit_log where entity = 'core.pulse_topics'`)).rows
  assert.deepEqual([audit.length, audit[0].verb, audit[0].after.signals, audit[0].after.reason, audit[0].after.comment], [1, 'dismissed', reporting.signals, 'addressed', 'Shipped in the November release.'], 'the audit log says what was dismissed, how strong it was and why')
  const kept = (await pg.query<any>(`select topic_title, reason, comment, signal_count, cardinality(signal_ids) as ids from core.pulse_dismissals`)).rows
  assert.deepEqual(kept, [{ topic_title: 'Reporting and digests', reason: 'addressed', comment: 'Shipped in the November release.', signal_count: reporting.signals, ids: reporting.signals }], 'the reason is kept as a record, with the signals it was about, for the matching to learn from')

  // The regrouping does not bring it back, and neither do one or two new signals about it.
  list = await (await call(owner, 'POST', '/pulse/topics/update', { mode: 'regroup' })).json()
  assert.ok(!list.topics.some((t: any) => t.title === 'Reporting and digests'), 'still hidden after the daily regrouping')
  const more = ['Our weekly digest of changed accounts is still built by hand every Monday.', 'Every Monday I build the weekly digest of changed accounts by hand, from three exports.', 'A weekly digest of accounts that changed would save the Monday scramble.']
  for (const [i, body] of more.entries()) {
    await call(owner, 'POST', '/pulse/signals', { body, channel: 'call_notes', account: `Account ${i}` })
    list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
    assert.equal(list.topics.some((t: any) => t.title === 'Reporting and digests'), i === 2, i === 2 ? 'the third new signal brings it back' : 'one or two are not enough')
  }
  assert.equal(list.topics.find((t: any) => t.title === 'Reporting and digests').signals, reporting.signals + 3)
})

test('praise counts a quarter in a topic score, and the breakdown says how many signals were praise', async () => {
  const { topicStats, PRAISE_FACTOR } = await import('./pulse-topics.js')
  const row = (kind: string) => ({ channel: 'call_notes' as const, kind, account: null, saidBy: null, occurredOn: '2026-11-18', createdAt: '2026-11-18T00:00:00Z' })
  const stats = topicStats([row('complaint'), row('request'), row('praise'), row('praise')], { call_notes: 1, slack: 0.5, salesforce: 0.8, support_tickets: 0.8 }, new Date('2026-11-20T12:00:00Z'))
  assert.equal(PRAISE_FACTOR, 0.25)
  assert.deepEqual(stats.breakdown, [{ channel: 'call_notes', count: 4, praise: 2, faded: 0, weight: 1, subtotal: 2.5 }], 'two in full and two at a quarter')
  assert.equal(stats.score, 2.5)
})

test('the read-only demo visitor sees Pulse only when an owner chooses to show it, and can only look', async () => {
  const { call, owner, alex, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  const visitor = createApp({ env: { DEV_TOKEN: 's3cret', PUBLIC_VIEW: 'true', WORKSPACE_SLUG: slug }, getDb: () => db })
  const look = (path: string) => visitor.request(`/api/v1${path}`)
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  await call(owner, 'POST', '/pulse/topics/update', {})

  assert.equal((await look('/pulse/topics')).status, 404, 'Pulse is on, but the demo switch is off: the visitor sees nothing')
  assert.deepEqual((await (await look('/me')).json()).features, { pulse: false, pulseEdit: false })
  assert.equal((await call(alex, 'PUT', '/pulse/demo', { enabled: true })).status, 403, 'only an owner chooses')
  assert.deepEqual(await (await call(owner, 'GET', '/pulse/demo')).json(), { enabled: false })
  assert.equal((await call(owner, 'PUT', '/pulse/demo', { enabled: 'yes' })).status, 422)

  assert.deepEqual(await (await call(owner, 'PUT', '/pulse/demo', { enabled: true })).json(), { enabled: true })
  const topics = await look('/pulse/topics')
  assert.equal(topics.status, 200, 'with the switch on, the visitor can look')
  assert.ok((await topics.json()).topics.length >= 3)
  assert.deepEqual((await (await look('/me')).json()).features, { pulse: true, pulseEdit: false }, 'to look, not to change')
  assert.equal((await look('/pulse/signals')).status, 200)
  const first = (await (await look('/pulse/topics')).json()).topics[0]
  assert.equal((await look(`/pulse/topics/${first.id}`)).status, 200, 'including a topic and its quotes')
  const write = (method: string, path: string, body: unknown = {}) => visitor.request(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) })
  for (const [m, path, body] of [['POST', '/pulse/topics/update', {}], ['POST', `/pulse/topics/${first.id}/dismiss`, {}], ['POST', '/pulse/signals/import', { text: 'A note that is long enough.' }], ['POST', '/pulse/projects', { name: 'x', topicIds: [first.id], questions: [] }], ['PUT', '/pulse/weights', { weights: { slack: 1 } }], ['GET', '/pulse/viewers', undefined], ['GET', '/pulse/sources', undefined]] as const) {
    const r = await write(m, path, body)
    assert.ok([401, 403, 404].includes(r.status), `${m} ${path}: the visitor cannot ${r.status}`)
  }
  assert.equal((await visitor.request('/api/v1/pulse/demo')).status === 200, false, 'and cannot read or change the switch')

  await call(owner, 'PUT', '/pulse/preview', { enabled: false })
  assert.equal((await look('/pulse/topics')).status, 404, 'with Pulse itself off, the demo switch shows nothing')
  const audit = (await pg.query<any>(`select verb, after from core.audit_log where entity = 'core.workspace_features' order by created_at`)).rows
  assert.ok(audit.some((r: any) => r.verb === 'turned on' && /read-only demo/.test(r.after.feature)), 'the demo switch is audited')
})

test('topics: a name appears once. New signals that group under an existing name join that topic, and duplicate names from before are folded into the oldest', async () => {
  const { call, owner, pg, db } = await fixture()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  let list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  const total = (l: any) => l.topics.reduce((a: number, t: any) => a + t.signals, 0)
  const unique = (l: any) => new Set(l.topics.map((t: any) => t.title.toLowerCase())).size === l.topics.length
  assert.ok(unique(list))
  const before = total(list)

  // Signals that read like reporting but share too few words with the existing topic to be attached to it: they group among themselves under the same name, and must join that topic, not start a second one.
  for (const body of ['Every month leadership wants a portfolio report and building it eats four hours of my day.', 'The quarterly executive report has to be assembled manually from three exports each time.']) await call(owner, 'POST', '/pulse/signals', { body, channel: 'call_notes', account: 'Initech' })
  list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  assert.ok(unique(list), 'no two topics share a name after new signals are grouped')
  assert.equal(total(list), before + 2, 'and both signals are counted')

  // A duplicate left by an earlier update is folded into the oldest on the next update.
  const reporting = (await pg.query<any>(`select id from core.pulse_topics where title = 'Reporting and digests' and status = 'active'`)).rows[0].id
  const twin = (await pg.query<any>(`insert into core.pulse_topics (workspace_id, title) select workspace_id, title from core.pulse_topics where id = $1 returning id`, [reporting])).rows[0].id
  await pg.query(`update core.pulse_topic_signals set topic_id = $2 where topic_id = $1 and signal_id = (select signal_id from core.pulse_topic_signals where topic_id = $1 limit 1)`, [reporting, twin])
  list = await (await call(owner, 'GET', '/pulse/topics')).json()
  assert.ok(!unique(list), 'the setup really has two topics with the same name')
  list = await (await call(owner, 'POST', '/pulse/topics/update', {})).json()
  assert.ok(unique(list), 'the duplicate is folded into the oldest')
  assert.equal(total(list), before + 2, 'with every signal still counted once')
  assert.equal((await pg.query<any>(`select status, merged_into from core.pulse_topics where id = $1`, [twin])).rows[0].status, 'merged')
})
