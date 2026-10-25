import { analyze, buildSteps, matchThemes } from '../shared/providers.mjs'
import { ApiError } from './errors.js'
import type { Env, Queryable } from './db.js'
import { insertMany } from './sql.js'
import { anthropicProvider } from './anthropic.js'
import { ModelOutputError, type AnalysisInput } from './ai-analysis.js'
import type { DraftInput, StepDraft } from './ai-drafting.js'

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
  /** Whole-project analysis by a model, given the stages and study context. Providers without it use `analyze`. */
  /** One requirements step drafted by a model, in the shape of one simulated step. Providers without it use `buildSteps`. */
  draftStep?(input: DraftInput): Promise<Priced<StepDraft & { promptVersion: string }>>
  analyzeProject?(input: AnalysisInput): Promise<Priced<{ themes: ReturnType<Fn<'analyze'>>; promptVersion: string }>>
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

// Live providers register here by name (AI_PROVIDER). A factory returns nothing when it is not fully configured (no key), so the app stays simulated.
const LIVE: Record<string, (env: Env) => AiProvider | undefined> = { anthropic: (env) => anthropicProvider(env) }

// AI_ENABLED=false is the kill switch: whatever else is set, every call is simulated.
export function getProvider(env: Env): AiProvider {
  if (env.AI_ENABLED === 'false') return simulatedProvider
  const make = env.AI_PROVIDER ? LIVE[env.AI_PROVIDER] : undefined
  return make?.(env) ?? simulatedProvider
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
  if (!ai.provider.live || (!usage.inputTokens && !usage.outputTokens && !usage.costUsd)) return
  await insertMany(db, 'core.ai_usage', [{ workspace_id: workspaceId, run_id: runId ?? null, purpose, provider: ai.provider.name, model: usage.model ?? null, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cost_usd: usage.costUsd }])
}

// Every model call goes through here: refuse when the month's budget is spent, run it, record what it cost.
// `db` should be the connection pool, not an open transaction, so the ledger keeps a call's cost even if the caller's work rolls back.
export async function callAi<T>(db: Queryable, ai: Ai, workspaceId: string, purpose: Purpose, call: (p: AiProvider) => Promise<Priced<T>>, runId?: string): Promise<T> {
  await assertBudget(db, ai, workspaceId)
  let priced: Priced<T>
  try {
    priced = await call(ai.provider)
  } catch (err) {
    // A call that was paid for but gave nothing usable still cost money, so it is recorded before the error goes on.
    const spent = (err as { usage?: Usage } | null)?.usage
    if (spent) await recordUsage(db, ai, workspaceId, purpose, spent, runId)
    throw err
  }
  const { value, usage } = priced
  await recordUsage(db, ai, workspaceId, purpose, usage, runId)
  return value
}

export type Fallback = 'budget' | 'credit'

// Notes what went wrong with a model call, for the owner's "last AI problem" report. It never throws: a failure to write the note must not
// turn a handled problem into a second one. Only the problem is kept, never the research text.
async function noteProblem(db: Queryable, workspaceId: string, purpose: Purpose, code: string, message: string, detail?: string): Promise<void> {
  try {
    await insertMany(db, 'core.ai_problems', [{ workspace_id: workspaceId, purpose, code, message, detail: detail ? detail.slice(0, 500) : null }])
  } catch (err) {
    console.error('could not record an AI problem', err instanceof Error ? err.message : err)
  }
}

export type AiProblem = { at: string; purpose: string; code: string; message: string; detail: string | null }

/** The most recent problems in the past 30 days, newest first. */
export async function recentAiProblems(db: Queryable, workspaceId: string, limit = 10): Promise<AiProblem[]> {
  const rows = (await db.query(`select created_at, purpose, code, message, detail from core.ai_problems where workspace_id = $1 and created_at > now() - interval '30 days' order by created_at desc limit $2`, [workspaceId, limit])).rows
  return rows.map((r) => ({ at: new Date(r.created_at).toISOString(), purpose: r.purpose, code: r.code, message: r.message, detail: r.detail }))
}

// Like callAi, but when the month's budget or the account's credit is used up the call is made again with the simulation, so
// the app stays usable. `fallback` says so. An unusable model reply becomes a plain 503; nothing is saved from it.
export async function callAiWithFallback<T>(db: Queryable, ai: Ai, workspaceId: string, purpose: Purpose, call: (p: AiProvider) => Promise<Priced<T>>, runId?: string): Promise<{ value: T; fallback?: Fallback }> {
  try {
    return { value: await callAi(db, ai, workspaceId, purpose, call, runId) }
  } catch (err) {
    const code = err instanceof ApiError ? err.code : ''
    if (code === 'ai_budget_reached' || code === 'ai_credit_exhausted') {
      await noteProblem(db, workspaceId, purpose, code, (err as ApiError).message, 'The simulation was used instead.')
      return { value: await callAi(db, { ...ai, provider: simulatedProvider }, workspaceId, purpose, call, runId), fallback: code === 'ai_budget_reached' ? 'budget' : 'credit' }
    }
    if (err instanceof ModelOutputError) {
      console.error(`ai_output_unusable (${purpose}): ${err.problems.join('; ').slice(0, 500)}`) // the problems only, never the text, so the Vercel log shows why
      const unusable = new ApiError(503, 'ai_output_unusable', 'The AI did not return a usable result. Nothing was changed; try again.')
      await noteProblem(db, workspaceId, purpose, unusable.code, unusable.message, err.problems.join('; '))
      throw unusable
    }
    if (err instanceof ApiError && code.startsWith('ai_')) await noteProblem(db, workspaceId, purpose, code, err.message)
    else if (!(err instanceof ApiError)) await noteProblem(db, workspaceId, purpose, 'ai_unexpected', 'The AI step stopped on an unexpected error.', err instanceof Error ? err.message.slice(0, 200) : undefined)
    throw err
  }
}
