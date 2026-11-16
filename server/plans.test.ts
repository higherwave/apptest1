// Plans and per-workspace AI caps. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { assertBudget, workspaceBudget, type Ai } from './ai.js'
import { scopeSql } from './db.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'
// @ts-expect-error plain ESM command-line tool
import { setPlan } from '../db/set-plan.mjs'

const live = (env: Record<string, string> = {}): Ai => ({ provider: { live: true } as any, env })
const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json', 'if-match': '1' }

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  await initWorkspace(pg, { name: 'Other', slug: 'other', owners: ['o@other.example.test'] })
  const ids = Object.fromEntries((await pg.query<any>(`select slug, id from core.workspaces`)).rows.map((r: any) => [r.slug, r.id])) as Record<string, string>
  const spend = (ws: string, usd: number) => pg.query(`insert into core.ai_usage (workspace_id, purpose, provider, input_tokens, output_tokens, cost_usd) values ($1, 'analysis', 'test', 1, 1, $2)`, [ws, usd])
  return { pg, db, ids, spend }
}

test('a workspace’s cap is its own setting, else its plan’s, else the deployment’s', async () => {
  const f = await fixture()
  const own = f.db.inWorkspace(f.ids.other)
  assert.deepEqual(await workspaceBudget(own, f.ids.other, {}), { budgetUsd: 10, source: 'deployment', plan: null })
  assert.equal((await workspaceBudget(own, f.ids.other, { AI_MONTHLY_BUDGET_USD: '7' })).budgetUsd, 7)
  await setPlan(f.pg, { slug: 'other', plan: 'pilot' })
  assert.deepEqual(await workspaceBudget(own, f.ids.other, { AI_MONTHLY_BUDGET_USD: '7' }), { budgetUsd: 20, source: 'plan', plan: 'pilot' })
  await setPlan(f.pg, { slug: 'other', plan: 'pilot', aiUsd: '35' })
  assert.deepEqual(await workspaceBudget(own, f.ids.other, {}), { budgetUsd: 35, source: 'workspace', plan: 'pilot' })
  await setPlan(f.pg, { slug: 'other', plan: 'none' })
  assert.equal((await workspaceBudget(own, f.ids.other, {})).source, 'deployment')
  await assert.rejects(setPlan(f.pg, { slug: 'other', plan: 'nope' }), /No plan/)
  await assert.rejects(setPlan(f.pg, { slug: 'other', plan: 'pilot', aiUsd: '-1' }), /zero or more/)
})

test('one workspace reaching its cap does not stop another, and the simulation never counts', async () => {
  const f = await fixture()
  await setPlan(f.pg, { slug: 'other', plan: 'pilot' }) // $20
  await f.spend(f.ids.other, 19.99)
  const a = f.db.inWorkspace(f.ids.other)
  await assertBudget(a, live(), f.ids.other) // just under
  await f.spend(f.ids.other, 0.02)
  await assert.rejects(assertBudget(a, live(), f.ids.other), (e: any) => e.status === 503 && e.code === 'ai_budget_reached')
  // The first workspace has spent nothing and is under its own cap.
  await assertBudget(f.db.inWorkspace(f.ids['higherwave-demo']), live(), f.ids['higherwave-demo'])
  // A simulated provider is never refused.
  await assertBudget(a, { provider: { live: false } as any, env: {} }, f.ids.other)
})

test('the platform ceiling stops every workspace once the month’s total reaches it', async () => {
  const f = await fixture()
  await setPlan(f.pg, { slug: 'other', plan: 'pilot' })
  await f.spend(f.ids.other, 6)
  await f.spend(f.ids['higherwave-demo'], 5)
  const env = { AI_PLATFORM_MONTHLY_USD: '12' }
  await assertBudget(f.db.inWorkspace(f.ids.other), live(env), f.ids.other) // 11 of 12
  await f.spend(f.ids['higherwave-demo'], 1)
  for (const ws of [f.ids.other, f.ids['higherwave-demo']]) {
    await assert.rejects(assertBudget(f.db.inWorkspace(ws), live(env), ws), /platform/i)
  }
  await assertBudget(f.db.inWorkspace(f.ids.other), live({}), f.ids.other) // no ceiling set: no limit
})

test('a workspace cannot change its own plan or any plan, and sees only its own spend', async () => {
  const f = await fixture()
  const as = async (ws: string, sql: string, params: unknown[] = []) => {
    let out: any
    await f.pg
      .transaction(async (tx: any) => {
        await tx.query(scopeSql(ws))
        out = (await tx.query(sql, params)).rows
        throw new Error('rollback')
      })
      .catch((e: any) => {
        if (e.message !== 'rollback') throw e
      })
    return out
  }
  await assert.rejects(as(f.ids.other, `update core.workspaces set plan_key = 'pilot', ai_monthly_usd = 9999 where id = $1`, [f.ids.other]), /permission denied/i)
  await assert.rejects(as(f.ids.other, `update core.plans set ai_monthly_usd = 9999`), /permission denied/i)
  await assert.rejects(as(f.ids.other, `insert into core.plans (key, name, ai_monthly_usd) values ('free', 'Free', 1000)`), /permission denied/i)
  await f.spend(f.ids['higherwave-demo'], 3)
  await f.spend(f.ids.other, 2)
  assert.equal(Number((await as(f.ids.other, `select coalesce(sum(cost_usd), 0)::float8 s from core.ai_usage`))[0].s), 2, 'only its own spend')
  assert.equal(Number((await as(f.ids.other, `select core.platform_ai_spend_this_month() t`))[0].t), 5, 'the platform total is a number, and only a number')
})

test('a plan’s seat limit refuses an invitation that would pass it, with 409 seat_limit', async () => {
  const f = await fixture()
  const app = createApp({ env: { ...TOKEN, WORKSPACE_SLUG: 'other', DEV_USER_EMAIL: 'o@other.example.test' }, getDb: () => f.db })
  const invite = (email: string) => app.request('/api/v1/members', { method: 'POST', headers: auth, body: JSON.stringify({ email, role: 'editor' }) })
  assert.equal((await invite('a@other.example.test')).status, 201, 'no plan: no limit')
  await f.pg.query(`update core.plans set seats = 3 where key = 'pilot'`)
  await setPlan(f.pg, { slug: 'other', plan: 'pilot' })
  assert.equal((await invite('b@other.example.test')).status, 201, 'the third place')
  const res = await invite('c@other.example.test')
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'seat_limit')
})
