// Migration 0025: the old "What are we testing?" items become one project description, and what people wrote is carried over.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDemoDatabase } from './test-utils.js'

const SQL = readFileSync(new URL('../db/migrations/0025_project_description.sql', import.meta.url), 'utf8')

test('item descriptions are joined into the description, outcomes are kept on the study, and a description someone wrote is never replaced', async () => {
  const { pglite } = await createDemoDatabase()
  const rows = (await pglite.query<any>(`select p.id, p.name from core.projects p where p.kind = 'research' order by p.name`)).rows
  const [first, second] = [rows[0].id, rows[1].id]
  const w = (await pglite.query<any>(`select workspace_id from core.projects where id = $1`, [first])).rows[0].workspace_id
  const study = async (id: string) => (await pglite.query<any>(`select what_testing w, outcomes o from research.studies where project_id = $1`, [id])).rows[0]
  const item = (project: string, position: number, description: string | null, outcomes: string[]) =>
    pglite.query(`insert into research.test_items (workspace_id, project_id, position, description, outcomes) values ($1, $2, $3, $4, $5)`, [w, project, position, description, outcomes])

  // A project as it was before: no description, three items (one with no description, one with blanks).
  await pglite.query(`update research.studies set what_testing = null, outcomes = '{}' where project_id = $1`, [first])
  await item(first, 0, '  Booking flow ', ['Outcome A', ' ', 'Outcome B'])
  await item(first, 1, null, ['Outcome C'])
  await item(first, 2, 'Reminders', [])
  // A project where someone already wrote a description and outcomes: untouched.
  await pglite.query(`update research.studies set what_testing = 'Mine', outcomes = '{"Mine too"}' where project_id = $1`, [second])
  await item(second, 0, 'Should not overwrite', ['Nor this'])

  await pglite.exec(SQL)
  assert.deepEqual(await study(first), { w: 'Booking flow\n\nReminders', o: ['Outcome A', 'Outcome B', 'Outcome C'] })
  assert.deepEqual(await study(second), { w: 'Mine', o: ['Mine too'] })

  // Run again: nothing changes (a migration may be applied to a database that already has it).
  await pglite.exec(SQL)
  assert.deepEqual(await study(first), { w: 'Booking flow\n\nReminders', o: ['Outcome A', 'Outcome B', 'Outcome C'] })
})
