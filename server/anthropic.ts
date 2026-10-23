// The live provider: Anthropic's Messages API, called with plain fetch so there is no SDK retry loop that could hit a spend limit
// again and again. Only analysis is live so far (slice E2); drafting and matching stay simulated until E3 and E4.
import type { Env } from './db.js'
import { ApiError } from './errors.js'
import { analyzeWithModel, type AnalysisInput, type ModelCall } from './ai-analysis.js'
import { draftWithModel } from './ai-drafting.js'
import { simulatedProvider, type AiProvider, type Usage } from './ai.js'

export const DEFAULT_ANALYSIS_MODEL = 'claude-sonnet-5-5'
// Dollars per million tokens, input and output (prompts up to 100K tokens).
export const PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
}
const API_URL = 'https://api.anthropic.com/v1/messages'
const TIMEOUT_MS = 240_000 // under the 300 s function limit, so a stuck call fails with our message, not Vercel's

export const costUsd = (model: string, inputTokens: number, outputTokens: number): number => {
  const p = PRICES[model]
  return p ? (inputTokens * p.in + outputTokens * p.out) / 1_000_000 : 0
}

const unavailable = (code: string, message: string) => new ApiError(503, code, message)

// Turns a failed HTTP answer into one plain message. The raw body is never passed on (it could echo request text).
export function mapFailure(status: number, body: string): ApiError {
  if (status === 400 && /usage limit|credit balance/i.test(body)) {
    return unavailable('ai_credit_exhausted', 'The AI account has run out of credit or hit its limit. Top it up, or set AI_ENABLED=false to use the simulation.')
  }
  if (status === 429) return unavailable('ai_rate_limited', 'The AI service is busy or a limit was reached. Wait a minute and try again.')
  if (status === 401 || status === 403) return unavailable('ai_not_configured', 'The AI service rejected the API key. Check ANTHROPIC_API_KEY.')
  if (status >= 500) return unavailable('ai_unreachable', 'The AI service is not responding. Try again shortly.')
  return unavailable('ai_request_rejected', 'The AI service refused this request.')
}

export function anthropicCall(env: Env, model: string, fetchImpl: typeof fetch = fetch): ModelCall {
  return async ({ system, user, maxTokens }) => {
    let res: Response
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw unavailable('ai_unreachable', 'The AI service did not answer in time. Try again shortly.')
    }
    if (!res.ok) throw mapFailure(res.status, await res.text().catch(() => ''))
    const json = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null
    const text = (json?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    const inputTokens = json?.usage?.input_tokens ?? 0
    const outputTokens = json?.usage?.output_tokens ?? 0
    const usage: Usage = { inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens), model }
    return { text, usage }
  }
}

export function anthropicProvider(env: Env, fetchImpl?: typeof fetch): AiProvider | undefined {
  if (!env.ANTHROPIC_API_KEY) return undefined
  const model = env.AI_ANALYSIS_MODEL && PRICES[env.AI_ANALYSIS_MODEL] ? env.AI_ANALYSIS_MODEL : DEFAULT_ANALYSIS_MODEL
  const call = anthropicCall(env, model, fetchImpl)
  const draftModel = env.AI_DRAFT_MODEL && PRICES[env.AI_DRAFT_MODEL] ? env.AI_DRAFT_MODEL : DEFAULT_ANALYSIS_MODEL
  const draftCall = draftModel === model ? call : anthropicCall(env, draftModel, fetchImpl)
  return {
    ...simulatedProvider,
    name: 'anthropic',
    live: true,
    analyzeProject: async (input: AnalysisInput) => {
      const r = await analyzeWithModel(call, input)
      return { value: { themes: r.themes, promptVersion: r.promptVersion }, usage: r.usage }
    },
    draftStep: async (input) => {
      const r = await draftWithModel(draftCall, input)
      return { value: { ...r.draft, promptVersion: r.promptVersion }, usage: r.usage }
    },
  }
}
