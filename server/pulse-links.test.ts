// Pulse slice 6: topics and Signal Flow point at each other. A topic lists the projects started from it and the Platform Insights themes that already cover it.
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { matchThemes } from './pulse-links.js'
import { fillDemoSignals } from '../scripts/demo-pulse-signals.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

test('a theme matches a topic when most of its title words are what the topic is about', () => {
  const topic = { title: 'Trust and accuracy', bodies: ['I do not trust the score, it was wrong on a renewal.', 'The score is inaccurate and I cannot trust it.'] }
  const themes = [
    { id: 'a', title: 'Trust in the health score' },
    { id: 'b', title: 'Scheduling conflicts' },
    { id: 'c', title: 'Accuracy of renewal dates' },
    { id: 'd', title: 'Wide dashboards' },
  ]
  const got = matchThemes(topic, themes).map((t) => t.id)
  assert.ok(got.includes('a'), 'the theme about trust in the score')
  assert.ok(!got.includes('b') && !got.includes('d'))
  assert.ok(got.length <= 2, 'at most two')
  assert.deepEqual(matchThemes(topic, [{ id: 'x', title: 'Wide' }]), [], 'a one-word title needs the word in the topic title or in two signals')
  assert.deepEqual(matchThemes({ title: 'Other', bodies: [] }, themes), [])
})

test('topics list their projects and the themes already covering them; a deleted project drops out', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const call = (method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  const ws = ((await pg.query<any>('select id from core.workspaces limit 1')).rows[0] as { id: string }).id
  await call('PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  await pg.query(`delete from insights.platform_themes where workspace_id = $1`, [ws])
  await pg.query(`insert into insights.platform_themes (workspace_id, title, category) values ($1, 'Trust in the health score', 'pain_point'), ($1, 'Scheduling conflicts', 'pain_point')`, [ws])
  const list = await (await call('POST', '/pulse/topics/update', {})).json()
  const trust = list.topics.find((t: any) => t.title === 'Trust and accuracy')
  const handoffs = list.topics.find((t: any) => t.title === 'Handoffs and lost context')
  assert.deepEqual(trust.researched.map((t: any) => t.title), ['Trust in the health score'], 'already researched')
  assert.deepEqual(handoffs.researched, [], 'not researched yet')
  assert.deepEqual(trust.projects, [])

  const questions = (await (await call('POST', '/pulse/questions', { topicIds: [trust.id], method: 'User Discussions' })).json()).questions
  const made = await call('POST', '/pulse/projects', { name: 'Trust study', description: 'Why people distrust the score.', methods: ['User Discussions'], topicIds: [trust.id], questions: questions.slice(0, 2).map((q: any) => ({ prompt: q.prompt, topicId: q.topicId })) })
  const { projectId } = await made.json()
  const after = await (await call('GET', `/pulse/topics/${trust.id}`)).json()
  assert.deepEqual(after.projects, [{ id: projectId, name: 'Trust study' }])
  assert.deepEqual((await (await call('GET', '/pulse/topics')).json()).topics.find((t: any) => t.id === trust.id).projects.map((p: any) => p.name), ['Trust study'])

  await call('DELETE', `/projects/${projectId}`)
  assert.deepEqual((await (await call('GET', `/pulse/topics/${trust.id}`)).json()).projects, [], 'a deleted project is no longer listed')
})
