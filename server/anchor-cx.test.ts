// The Anchor CX demo story (db/seed/anchor-cx/README.md), loaded next to the original demo, read through the API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { PLATFORM_KEYWORDS } from '../shared/platform-keywords.mjs'
// @ts-expect-error plain ESM
import * as DATA from '../db/seed/anchor-cx/data.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

async function fixture() {
  const { db, pglite: pg } = await createDemoDatabase({ anchor: true })
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const get = async (path: string) => (await app.request('/api/v1' + path)).json()
  return { app, db, get, pg }
}

const ANCHOR = ['Health score trust', 'Renewal workspace', 'Portfolio reporting']

test('Anchor CX adds three analysed projects beside the original demo, and the original is unchanged', async () => {
  const { get } = await fixture()
  const projects = (await get('/projects')).data
  assert.equal(projects.length, 7, 'four original projects and three Anchor CX')
  for (const name of ANCHOR) {
    const p = projects.find((x: any) => x.name === name)
    assert.ok(p, name)
    assert.equal(p.status, 'analyzed')
    assert.equal(p.sessions, 4, 'four transcripts each')
  }
  assert.deepEqual(projects.find((x: any) => x.name === 'Health score trust').methods, ['Contextual (walk-through)'])
  assert.deepEqual(projects.find((x: any) => x.name === 'Portfolio reporting').methods, ['User Discussions'])
})

test('each Anchor CX project has a plan, four participants with session lengths, transcripts in all three formats, and is not out of date', async () => {
  const { get } = await fixture()
  const platforms = new Set<string>()
  for (const name of ANCHOR) {
    const id = (await get('/projects')).data.find((x: any) => x.name === name).id
    const detail = await get(`/projects/${id}`)
    assert.equal(detail.participants.length, 4)
    assert.ok(detail.participants.every((p: any) => [30, 45, 60].includes(p.sessionMinutes)), 'every participant has a session length')
    assert.ok(detail.stages.length === 5 && detail.tasks.length === 4)
    const list = await get(`/projects/${id}/transcripts`)
    assert.equal(list.transcripts.length, 4)
    assert.equal(list.needsAnalysis, false, 'the analysis matches the transcripts')
    for (const t of list.transcripts) {
      platforms.add(t.platform)
      assert.equal(t.speakers.filter((s: any) => s.role === 'participant').length, 1)
      assert.ok(t.speakers.find((s: any) => s.role === 'participant').participant, 'the speaker is matched to a participant')
    }
  }
  assert.deepEqual([...platforms].sort(), ['meet', 'teams', 'zoom'])
})

test('Platform Insights rolls the nine Anchor CX themes up across the three studies', async () => {
  const { get } = await fixture()
  const body = await get('/insights/themes')
  assert.equal(body.projects.length, 6, 'three original and three Anchor CX')
  const titles = Object.values(DATA.THEMES).map((t: any) => t.title)
  const anchor = body.themes.filter((t: any) => titles.includes(t.title))
  assert.equal(anchor.length, 9)
  const trust = anchor.find((t: any) => t.title === DATA.THEMES.T1.title)
  assert.equal(trust.projectCount, 3)
  assert.equal(trust.participantCount, 12, 'everyone, in all three studies')
  assert.equal(trust.status, 'worked', 'its requirement’s newest finding says it worked')
  assert.match(trust.summary, /./)
  const reporting = anchor.find((t: any) => t.title === DATA.THEMES.T5.title)
  assert.equal(reporting.status, 'not_addressed')
  assert.equal(reporting.opportunity, true, 'raised in three projects and nobody has written a requirement for it')
  assert.equal(anchor.find((t: any) => t.title === DATA.THEMES.T2.title).status, 'worked')
  assert.equal(anchor.find((t: any) => t.title === DATA.THEMES.T4.title).status, 'too_early')
  assert.equal(anchor.find((t: any) => t.title === DATA.THEMES.T3.title).status, 'in_progress')
  // The two that came up in the later studies and that no requirement answers: open opportunities, in two studies each, on stages 1 and 3.
  for (const [key, stage] of [['T8', 0], ['T9', 2]] as const) {
    const t = anchor.find((x: any) => x.title === DATA.THEMES[key].title)
    assert.deepEqual([t.projectCount, t.status, t.opportunity], [2, 'not_addressed', true], key)
    assert.ok(t.participantCount >= 4, `${key} was raised by several people`)
    const journey = (await get('/insights/journey')).stages.find((x: any) => x.name === DATA.STAGES[stage])
    assert.ok(journey.themes.some((x: any) => x.title === t.title && x.opportunity), `${key} is an opportunity on stage ${stage + 1}`)
  }
  assert.equal(body.recommendations.length, 4 + 6)
  assert.ok(body.recommendations.some((r: any) => /why the health score changed/.test(r.title) && r.themes.length === 1))
})

test('Personas groups the twelve people into the four Anchor CX roles', async () => {
  const { get } = await fixture()
  const body = await get('/insights/customers')
  const names = body.groups.map((g: any) => g.name)
  for (const role of ['Customer Success Manager', 'Support Lead', 'CS Operations Manager', 'Executive']) {
    const group = body.groups.find((g: any) => g.name === role)
    assert.ok(group, `${role} in ${names.join(', ')}`)
    assert.equal(group.participantCount, 3, 'one of each in every study')
  }
})

test('the Anchor CX journey has five stages of its own, with the pain before the delight', async () => {
  const { get } = await fixture()
  const body = await get('/insights/journey')
  for (const stage of DATA.STAGES) assert.ok(body.stages.some((s: any) => s.name === stage), stage)
  const prepare = body.stages.find((s: any) => s.name === DATA.STAGES[0])
  assert.ok(prepare.themes.some((t: any) => t.title === DATA.THEMES.T7.title))
})

test('study 1 is published with its board, designs and measured results, and shows up as a case study', async () => {
  const { get, app } = await fixture()
  const id = (await get('/projects')).data.find((x: any) => x.name === 'Health score trust').id
  const specId = (await get('/specs')).data.find((x: any) => x.projectId === id).id
  const spec = await get(`/specs/${specId}`)
  assert.equal(spec.status, 'published')
  assert.equal(spec.steps.length, 8)
  assert.ok(spec.steps.every((s: any) => s.status === 'approved'))
  const board = await get(`/projects/${id}/board`)
  const stories = board.stories
  assert.equal(stories.length, 7, 'six requirements and one open question, for the theme held out of scope')
  const editor = { authorization: 'Bearer s3cret' }
  const asEditor = await (await app.request(`/api/v1/specs/${specId}`, { headers: editor })).json()
  assert.equal(asEditor.boardChanges, 0, 'the board matches the document, so there is nothing to update')
  assert.deepEqual(asEditor.preview, { requirements: 6, openQuestions: 1 })
  const launchId = (await get(`/projects/${id}/launch`)).launch.id
  const success = await get(`/launches/${launchId}/success`)
  assert.equal(success.measures.length, 5, 'a short list for the release, not one for each requirement')
  const result = (kind: string, detail: RegExp) => success.measures.find((m: any) => m.metricKind === kind && detail.test(m.detail ?? '')).result
  assert.equal(result('tickets', /why a score changed/), 'worked')
  assert.equal(result('engagement', /alerts/), 'too_early')
  assert.equal(result('time_to_value', /renewal/), null, 'not read yet')
  assert.equal(success.measures.filter((m: any) => m.result === 'needs_attention').length, 0)
  assert.equal(success.locked, true)
  assert.deepEqual(success.reviewPoints.map((p: any) => !!p.on), [true, true, true])
  // Measure shows what was read, by theme; the measure with no reading is not there.
  const results = await get('/measure/results')
  const shown = results.themes.flatMap((t: any) => t.projects.flatMap((p: any) => p.measures.map((m: any) => m.id)))
  assert.ok(shown.length >= 4 && !shown.includes(success.measures.find((m: any) => m.result === null).id))
  const briefs = (await get('/insights/case-briefs')).data
  assert.ok(briefs.some((c: any) => c.projectName === 'Health score trust'), 'a project with something that worked and nothing needing attention is a case study')
})

test('study 1’s launch went ahead with conditions: answers with reasons and links, one asking for changes, two never answered, and a reviewer for each step', async () => {
  const { app, get } = await fixture()
  const project = (await get('/projects')).data.find((x: any) => x.name === 'Health score trust')
  const found = await get(`/projects/${project.id}/launch`)
  assert.equal(found.launch.name, 'Health score explanations: general availability')
  const launch = await get(`/launches/${found.launch.id}`)
  const state = (step: string) => launch.steps.find((s: any) => s.step === step).state
  assert.deepEqual(['product_leadership', 'legal', 'documentation', 'marketing', 'sales', 'final_decision'].map(state), ['ready_with_conditions', 'ready', 'changes_needed', 'waiting', 'waiting', 'go_with_conditions'])
  assert.equal(launch.summary.state, 'go_with_conditions')
  assert.deepEqual(launch.summary.blocking.map((b: any) => b.step), ['documentation'])
  assert.match(launch.steps.find((s: any) => s.step === 'documentation').answer.rationale, /90-day window/)
  assert.equal(launch.steps.find((s: any) => s.step === 'legal').links.length, 1)
  assert.equal(launch.steps.every((s: any) => s.answer === null || s.answer.reopened === false), true, 'the answers were given on the brief as it is now')
  assert.ok(launch.brief.requirements.length >= 5, 'the brief lists what is being built')
  void app
})

test('the matcher knows the Anchor CX platform themes, and none of them match the original demo’s themes', async () => {
  const titles = Object.values(DATA.THEMES).map((t: any) => t.title)
  for (const t of titles) assert.ok(Array.isArray(PLATFORM_KEYWORDS[t]) && PLATFORM_KEYWORDS[t].length >= 1, `keywords for ${t}`)
  const { db } = await fixture()
  const clinic = (await db.query(`select t.title from research.themes t join core.projects p on p.id = t.project_id where p.name not in ('Health score trust', 'Renewal workspace', 'Portfolio reporting')`)).rows as { title: string }[]
  for (const { title } of clinic) {
    for (const anchorTitle of titles) {
      const hit = (PLATFORM_KEYWORDS[anchorTitle] as string[]).some((k) => new RegExp('\\b(?:' + k + ')\\b').test(title.toLowerCase()))
      assert.equal(hit, false, `"${title}" should not look like "${anchorTitle}"`)
    }
  }
})

test('retiring the clinic demo leaves only Anchor CX, with its own journey, themes and recommendations', async () => {
  const { db, get } = await fixture()
  // @ts-expect-error plain ESM
  const { retireClinic, findClinic } = await import('../db/seed/retire-clinic.mjs')
  const ws = (await db.query(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const before = await findClinic(db, ws)
  assert.equal(before.projects.length, 4)
  assert.equal(before.platformThemes.length, 5)
  assert.equal(before.recommendations.length, 4)
  assert.equal(before.caseStudies.length, 4)
  assert.deepEqual(await retireClinic(db, ws), { projects: 4, platformThemes: 5, recommendations: 4, caseStudies: 4 })
  assert.deepEqual((await get('/projects')).data.map((p: any) => p.name).sort(), [...ANCHOR].sort())
  const themes = await get('/insights/themes')
  assert.equal(themes.themes.length, 9)
  assert.equal(themes.recommendations.length, 6)
  assert.equal(themes.totalParticipants, 12)
  assert.equal((await get('/insights/journey')).stages.length, 5, 'only the Anchor CX stages')
  assert.equal((await get('/insights/case-studies')).data.length, 0, 'no written case studies, but the project brief remains')
  assert.ok((await get('/insights/case-briefs')).data.some((c: any) => c.projectName === 'Health score trust'))
  assert.deepEqual(await retireClinic(db, ws), { projects: 0, platformThemes: 0, recommendations: 0, caseStudies: 0 }, 'a second run finds nothing')
})

test('adding the later themes to a story that is already loaded changes nothing else, and ends where a fresh load would', async () => {
  const { db, get, pg } = await fixture()
  // @ts-expect-error plain ESM
  const { addLaterThemes, aid } = await import('../db/seed/anchor-cx/load.mjs')
  const ws = (await pg.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const owner = (await pg.query<any>(`select user_id from core.memberships where workspace_id = $1 and role = 'owner' order by created_at limit 1`, [ws])).rows[0].user_id
  const state = async () => ({
    later: (await get('/insights/themes')).themes.filter((t: any) => /^(Account contacts|Nobody owns)/.test(t.title)).map((t: any) => [t.title, t.projectCount, t.participantCount, t.status, t.opportunity]),
    utterances: Number((await pg.query<any>(`select count(*)::int n from research.utterances`)).rows[0].n),
    quotes: Number((await pg.query<any>(`select count(*)::int n from research.theme_quotes`)).rows[0].n),
    recs: Number((await pg.query<any>(`select count(*)::int n from insights.recommendations`)).rows[0].n),
    hashes: (await pg.query<any>(`select id, input_hash from core.agent_runs where kind = 'analysis' order by id`)).rows,
    texts: (await pg.query<any>(`select id, content_hash from research.transcripts order by id`)).rows,
  })
  const fresh = await state()
  assert.equal(fresh.later.length, 2)

  // Rewind to a workspace loaded before those themes existed: no T8 or T9 rows, and the eight transcripts without their last lines.
  const themeIds = ['a2', 'a3'].flatMap((k) => ['T8', 'T9'].map((t) => aid(`theme:${k}:${t}`)))
  await pg.query(`delete from research.theme_quotes where theme_id = any($1::uuid[])`, [themeIds])
  await pg.query(`delete from insights.platform_theme_sources where theme_id = any($1::uuid[])`, [themeIds])
  await pg.query(`delete from research.themes where id = any($1::uuid[])`, [themeIds])
  await pg.query(`delete from insights.platform_themes where id = any($1::uuid[])`, [['T8', 'T9'].map((t) => aid('pt:' + t))])
  await pg.query(`delete from insights.recommendation_themes where recommendation_id = $1`, [aid('rec:5')])
  await pg.query(`delete from insights.recommendations where id = $1`, [aid('rec:5')])
  // How many lines were added to each (study 2: participants 1 to 4, study 3: 1 to 4).
  const added: Record<string, number[]> = { a2: [2, 4, 2, 4], a3: [2, 2, 2, 2] }
  for (const [key, counts] of Object.entries(added)) {
    for (const [ti, n] of counts.entries()) {
      const id = aid(`transcript:${key}:${ti}`)
      const raw = (await pg.query<any>(`select raw_text from research.transcripts where id = $1`, [id])).rows[0].raw_text as string
      const total = Number((await pg.query<any>(`select count(*)::int n from research.utterances where transcript_id = $1`, [id])).rows[0].n)
      const first = (await pg.query<any>(`select text from research.utterances where transcript_id = $1 and position = $2`, [id, total - n + 1])).rows[0].text as string
      const at = raw.indexOf(first)
      const cut = raw.includes('-->') ? raw.lastIndexOf('\n\n', at) : raw.lastIndexOf('\n', at)
      await pg.query(`delete from research.utterances where transcript_id = $1 and position > $2`, [id, total - n])
      await pg.query(`update research.transcripts set raw_text = $2 where id = $1`, [id, raw.slice(0, cut + 1)])
    }
  }
  const old = await state()
  assert.equal(old.later.length, 0, 'the rewound workspace has neither theme')
  // Something built by hand on one of the studies, which a reload would have deleted.
  await pg.query(`insert into delivery.launches (id, workspace_id, project_id, name, created_by, updated_by) values ($1, $2, $3, 'Renewal workspace', $4, $4)`, [aid('test:hand-built-launch'), ws, aid('project:a2'), owner])

  const did = await addLaterThemes(db, { workspaceId: ws, userId: owner })
  assert.deepEqual(did, { utterances: 20, themes: 4, quotes: 10, platformThemes: 2, matches: 4, recommendations: 1 })
  const after = await state()
  assert.deepEqual(after, fresh, 'the same as a fresh load: themes, utterances, quotes, recommendations, and the hashes that say the studies are not out of date')
  assert.equal(Number((await pg.query<any>(`select count(*)::int n from delivery.launches where id = $1`, [aid('test:hand-built-launch')])).rows[0].n), 1, 'what was built by hand is still there')
  assert.deepEqual(await addLaterThemes(db, { workspaceId: ws, userId: owner }), { utterances: 0, themes: 0, quotes: 0, platformThemes: 0, matches: 0, recommendations: 0 }, 'run again, it finds nothing to add')
})

test('a reload refuses to delete what was built by hand on the studies, says what it would delete, and puts the studies back on the example workflow', async () => {
  const { app, db, get, pg } = await fixture()
  // @ts-expect-error plain ESM
  const { loadAnchorCx, handBuiltContent, HandBuiltContentError, aid } = await import('../db/seed/anchor-cx/load.mjs')
  const auth = { authorization: 'Bearer s3cret' }
  const ws = (await pg.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const owner = (await pg.query<any>(`select user_id from core.memberships where workspace_id = $1 and role = 'owner' order by created_at limit 1`, [ws])).rows[0].user_id
  await app.request('/api/v1/workflows/sample', { method: 'POST', headers: auth })
  assert.deepEqual(await handBuiltContent(db, ws), [], 'a story as loaded has nothing built by hand')

  // Someone builds a launch on a study.
  await pg.query(`insert into delivery.launches (id, workspace_id, project_id, name, created_by, updated_by) values ($1, $2, $3, 'Renewal workspace', $4, $4)`, [aid('test:launch'), ws, aid('project:a2'), owner])
  const found = await handBuiltContent(db, ws)
  assert.deepEqual(found.map((f: any) => [f.what, f.count]), [['launches', 1]])
  assert.match(found[0].items[0], /Renewal workspace/)
  await assert.rejects(loadAnchorCx(db, { workspaceId: ws, userId: owner }), (e: any) => e instanceof HandBuiltContentError && /1 launches/.test(e.message) && /Renewal workspace/.test(e.message))
  assert.equal(Number((await pg.query<any>(`select count(*)::int n from delivery.launches where id = $1`, [aid('test:launch')])).rows[0].n), 1, 'nothing was deleted')

  // Asked for in so many words, it reloads: the hand-built launch goes, and the studies are on the example workflow again.
  await loadAnchorCx(db, { workspaceId: ws, userId: owner, replaceHandBuilt: true })
  assert.equal(Number((await pg.query<any>(`select count(*)::int n from delivery.launches where id = $1`, [aid('test:launch')])).rows[0].n), 0)
  const flow = (await get('/workflows')).data.find((w: any) => w.name === 'Customer success lifecycle')
  assert.equal(flow.projectCount, 3, 'back on the workflow after the reload')
  const journey = await get(`/insights/journey?workflow=${flow.id}`)
  assert.ok(journey.stages.every((st: any) => st.projectCount === 3) && journey.stages.some((st: any) => st.personas.length > 0), 'with its research')
  // And a plain reload of a story with nothing built by hand just works.
  await loadAnchorCx(db, { workspaceId: ws, userId: owner })
})

test('the Anchor CX example workflow: adding it puts the three studies on it, and its journey is the aggregate with the four personas', async () => {
  const { app, get, pg } = await fixture()
  const auth = { authorization: 'Bearer s3cret' }
  const before = await get('/workflows')
  assert.deepEqual([before.data, before.sampleMissing], [[], true])
  const done = await (await app.request('/api/v1/workflows/sample', { method: 'POST', headers: auth })).json()
  assert.equal(done.sampleMissing, false)
  const flow = done.data.find((w: any) => w.name === 'Customer success lifecycle')
  assert.deepEqual(flow.stages.map((s: any) => s.name), DATA.STAGES, 'the example’s stages are the Anchor CX story’s journey stages')
  assert.equal(flow.projectCount, 3, 'the three Anchor CX studies went on it')
  assert.ok(flow.stages.every((s: any) => s.backstage.length >= 2 && s.backstage.every((b: any) => b.owner)))
  // The original clinic demo is on no workflow: its stages are not the example's.
  const projects = (await get('/projects')).data
  for (const p of projects.filter((x: any) => !ANCHOR.includes(x.name))) {
    const blueprint = await get(`/projects/${p.id}/blueprint`)
    assert.equal(blueprint.workflow, null, p.name)
  }
  for (const name of ANCHOR) {
    const p = projects.find((x: any) => x.name === name)
    const blueprint = await get(`/projects/${p.id}/blueprint`)
    assert.equal(blueprint.workflow.name, 'Customer success lifecycle')
    assert.ok(blueprint.stages.every((s: any) => s.workflowStageId), `${name}: every journey stage is mapped`)
  }
  // The journey of that workflow: five stages, research from the three studies, and the four personas.
  const journey = await get(`/insights/journey?workflow=${flow.id}`)
  assert.deepEqual(journey.stages.map((s: any) => s.name), DATA.STAGES)
  assert.equal(journey.workflow.projects, 3)
  assert.ok(journey.stages.every((s: any) => s.projectCount === 3))
  assert.ok(journey.stages.some((s: any) => s.themes.length > 0))
  const personas = new Set(journey.stages.flatMap((s: any) => s.personas.map((p: any) => p.name)))
  assert.deepEqual([...personas].sort(), ['CS Operations Manager', 'Customer Success Manager', 'Executive', 'Support Lead'])
  // Adding it again changes nothing.
  assert.equal((await (await app.request('/api/v1/workflows/sample', { method: 'POST', headers: auth })).json()).data.length, 1)
  // Reloading the demo recreates the studies, which come back on no workflow: adding the example again (or running scripts/demo-workflow-link.ts) puts them back.
  await pg.query(`delete from insights.project_workflows`)
  assert.equal((await get('/workflows')).data[0].projectCount, 0, 'the studies are on no workflow, as after a reload')
  const again = await (await app.request('/api/v1/workflows/sample', { method: 'POST', headers: auth })).json()
  assert.equal(again.data.find((w: any) => w.name === 'Customer success lifecycle').projectCount, 3, 'the three studies are back on it')
  assert.equal(again.data.length, 1, 'and no second workflow was made')
  const back = await get(`/insights/journey?workflow=${flow.id}`)
  assert.ok(back.stages.every((s: any) => s.projectCount === 3) && back.stages.some((s: any) => s.personas.length > 0), 'the journey has its research again')
})
