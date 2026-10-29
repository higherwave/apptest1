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
  const { db } = await createDemoDatabase({ anchor: true })
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const get = async (path: string) => (await app.request('/api/v1' + path)).json()
  return { app, db, get }
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
  assert.deepEqual(projects.find((x: any) => x.name === 'Health score trust').methods, ['Contextual interview'])
  assert.deepEqual(projects.find((x: any) => x.name === 'Portfolio reporting').methods, ['Concept test'])
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

test('Platform Insights rolls the seven Anchor CX themes up across all three studies', async () => {
  const { get } = await fixture()
  const body = await get('/insights/themes')
  assert.equal(body.projects.length, 6, 'three original and three Anchor CX')
  const titles = Object.values(DATA.THEMES).map((t: any) => t.title)
  const anchor = body.themes.filter((t: any) => titles.includes(t.title))
  assert.equal(anchor.length, 7)
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
  assert.equal(body.recommendations.length, 4 + 5)
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
  const measure = await get(`/projects/${id}/measure`)
  const byKey = Object.fromEntries(measure.items.map((i: any) => [i.key, i]))
  assert.equal(byKey.R1.result, 'worked')
  assert.equal(byKey.R2.result, 'worked')
  assert.equal(byKey.R4.result, 'too_early')
  assert.equal(measure.items.filter((i: any) => i.result === 'needs_attention').length, 0)
  const briefs = (await get('/insights/case-briefs')).data
  assert.ok(briefs.some((c: any) => c.projectName === 'Health score trust'), 'a project with something that worked and nothing needing attention is a case study')
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
