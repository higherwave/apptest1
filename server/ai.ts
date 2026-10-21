import { analyze, buildSteps, matchThemes } from '../shared/providers.mjs'
import { ApiError } from './errors.js'
import type { Env, Queryable } from './db.js'
import { insertMany } from './sql.js'

// The one seam between the app and any model. Each method has the input and output of the simulated function it replaces
// (shared/providers.mjs) and returns the value with what the call cost, so the app never needs to know which provider ran.
type Fn<K extends 'analyze' | 'buildSteps' | 'matchThemes'> = typeof import('../shared/providers.mjs')[K]
export type Usage = { inputTokens: number; outputTokens: number; costUsd: number; model?: string }
export type Priced<T> = { value: T; usage: Usage }
export type AiProvider = {
  name: string
  /** True when a call can cost money. Only live providers are budget-checked and recorded. */
  live: boolean
  analyze(...args: Parameters<Fn<'analyze'>>): Promise<Priced<ReturnType<Fn<'analyze'>>>>
  buildSteps(...args: Parameters<Fn<'buildSteps'>>): Promise<Priced<ReturnType<Fn<'buildSteps'>>>>
  matchThemes(...args: Parameters<Fn<'matchThemes'>>): Promise<Priced<ReturnType<Fn<'matchThemes'>>>>
}
export type Ai = { provider: AiProvider; env: Env }
export type Purpose = 'analysis' | 'spec_step' | 'theme_match'

const FREE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

// The prototype's keyword logic. Free, deterministic, and what the app uses until a live provider is configured.
export const simulatedProvider: AiProvider = {
  name: 'stub',
  live: false,
  analyze: async (...a) => ({ value: analyze(...a), usage: FREE }),
  buildSteps: async (...a) => ({ value: buildSteps(...a), usage: FREE }),
  matchThemes: async (...a) => ({ value: matchThemes(...a), usage: FREE }),
}

// Live providers register here by name (AI_PROVIDER). None exist yet; slice E2 adds the first.
const LIVE: Record<string, (env: Env) => AiProvider> = {}

// AI_ENABLED=false is the kill switch: whatever else is set, every call is simulated.
export function getProvider(env: Env): AiProvider {
  if (env.AI_ENABLED === 'false') return simulatedProvider
  const make = env.AI_PROVIDER ? LIVE[env.AI_PROVIDER] : undefined
  return make ? make(env) : simulatedProvider
}

export const makeAi = (env: Env, provider: AiProvider = getProvider(env)): Ai => ({ provider, env })
export const aiMode = (ai: Ai): 'live' | 'simulated' => (ai.provider.live ? 'live' : 'simulated')

export const monthlyBudgetUsd = (env: Env): number => {
  const n = Number(env.AI_MONTHLY_BUDGET_USD)
  return env.AI_MONTHLY_BUDGET_USD && Number.isFinite(n) && n >= 0 ? n : 10
}

export async function spentThisMonthUsd(db: Queryable, workspaceId: string): Promise<number> {
  const r = await db.query(`select coalesce(sum(cost_usd), 0)::float8 as spent from core.ai_usage where workspace_id = $1 and created_at >= date_trunc('month', now())`, [workspaceId])
  return r.rows[0].spent as number
}

export async function assertBudget(db: Queryable, ai: Ai, workspaceId: string): Promise<void> {
  if (!ai.provider.live) return
  if ((await spentThisMonthUsd(db, workspaceId)) >= monthlyBudgetUsd(ai.env)) {
    throw new ApiError(503, 'ai_budget_reached', 'The monthly AI budget is used up. Raise AI_MONTHLY_BUDGET_USD or set AI_ENABLED=false to use the simulation.')
  }
}

export async function recordUsage(db: Queryable, ai: Ai, workspaceId: string, purpose: Purpose, usage: Usage, runId?: string): Promise<void> {
  if (!ai.provider.live) return
  await insertMany(db, 'core.ai_usage', [{ workspace_id: workspaceId, run_id: runId ?? null, purpose, provider: ai.provider.name, model: usage.model ?? null, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cost_usd: usage.costUsd }])
}

// Every model call goes through here: refuse when the month's budget is spent, run it, record what it cost.
// `db` should be the connection pool, not an open transaction, so the ledger keeps a call's cost even if the caller's work rolls back.
export async function callAi<T>(db: Queryable, ai: Ai, workspaceId: string, purpose: Purpose, call: (p: AiProvider) => Promise<Priced<T>>, runId?: string): Promise<T> {
  await assertBudget(db, ai, workspaceId)
  const { value, usage } = await call(ai.provider)
  await recordUsage(db, ai, workspaceId, purpose, usage, runId)
  return value
}
