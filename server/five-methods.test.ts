// Migration 0027: the earlier seven test methods become the five, in order, without repeats, for projects and templates.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { METHOD_OPTIONS } from './schemas.js'
import { createDemoDatabase } from './test-utils.js'

const SQL = readFileSync(new URL('../db/migrations/0027_five_test_methods.sql', import.meta.url), 'utf8')

test('the five methods are the options, and the migration maps the old seven onto them', async () => {
  assert.deepEqual([...METHOD_OPTIONS], ['Contextual (walk-through)', 'User Discussions', 'Usability Test', 'Support or CSM channels', 'Survey'])
  const { pglite } = await createDemoDatabase()
  const ids = (await pglite.query<any>(`select project_id from research.studies order by project_id limit 3`)).rows.map((r) => r.project_id as string)
  const set = (id: string, methods: string[]) => pglite.query(`update research.studies set methods = $2 where project_id = $1`, [id, methods])
  const methods = async (id: string) => ((await pglite.query<any>(`select methods from research.studies where project_id = $1`, [id])).rows[0].methods as string[])

  await set(ids[0], ['Moderated usability test', 'Survey follow-up', 'Card sort', 'Unmoderated test'])
  await set(ids[1], ['Contextual interview', 'Diary study', 'Concept test', 'Mind reading'])
  await set(ids[2], ['Support or CSM channels', 'Survey'])
  const t = (await pglite.query<any>(`select id from core.templates where kind = 'study' limit 1`)).rows[0].id as string
  await pglite.query(`update core.templates set body = jsonb_set(body, '{methods}', $2::jsonb) where id = $1`, [t, JSON.stringify(['Concept test', 'Survey follow-up', 'Diary study'])])

  await pglite.exec(SQL)
  assert.deepEqual(await methods(ids[0]), ['Usability Test', 'Survey'], 'three usability kinds are one, order kept')
  assert.deepEqual(await methods(ids[1]), ['Contextual (walk-through)', 'User Discussions'], 'an unknown label is dropped')
  assert.deepEqual(await methods(ids[2]), ['Support or CSM channels', 'Survey'], 'the new names are left alone')
  assert.deepEqual((await pglite.query<any>(`select body -> 'methods' m from core.templates where id = $1`, [t])).rows[0].m, ['User Discussions', 'Survey'], 'templates follow')

  await pglite.exec(SQL)
  assert.deepEqual(await methods(ids[0]), ['Usability Test', 'Survey'], 'running it again changes nothing')
})
