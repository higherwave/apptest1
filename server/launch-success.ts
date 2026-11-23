// "How will we know it worked?": a launch's expectations. It gathers what is already known (the goals from the product brief), the launch's own measures (a short
// rolled-up list, set here until the final decision is a go), and when to look: 30, 60 and 90 days after that final approval. Measures are not kept by requirement;
// a measure may name the requirements it covers, as context.
import type { Queryable } from './db.js'
import { launchForSystem } from './launches.js'
import { getLaunchMeasures, measuresLocked, type LaunchMeasure } from './launch-measures.js'

export type ReviewPoint = { key: string; label: string; days: number; on: string | null }
export type LaunchSuccess = {
  published: boolean
  projectId: string
  problem: string | null
  goals: string[] | null
  /** The launch's expectations: a short list, and the version a save is checked against. */
  measures: LaunchMeasure[]
  measuresVersion: number
  /** True once the final decision is a go: the expectations are fixed. */
  locked: boolean
  /** The day the final decision was a go, when the clock for the review points started; null before that. */
  approvedOn: string | null
  reviewPoints: ReviewPoint[]
  reviewer: string | null
}

const POINTS = [
  { key: 'd30', label: '30 days', days: 30 },
  { key: 'd60', label: '60 days', days: 60 },
  { key: 'd90', label: '90 days', days: 90 },
]

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The success view of one launch, or null when the launch is not there. Not for an external approver (the caller refuses them). */
export async function launchSuccess(db: Queryable, workspaceId: string, launchId: string): Promise<LaunchSuccess | null> {
  const launch = await launchForSystem(db, workspaceId, launchId, { withBrief: true })
  if (!launch) return null
  const locked = measuresLocked(launch.summary.state)
  const approvedOn = locked
    ? ((await db.query(`select to_char(answered_at at time zone 'UTC', 'YYYY-MM-DD') as day from delivery.launch_answers where launch_id = $1 and step = 'final_decision' order by answered_at desc limit 1`, [launchId])).rows[0]?.day ?? null)
    : null
  const { version, items } = await getLaunchMeasures(db, launchId)
  return {
    published: launch.brief.published,
    projectId: launch.projectId,
    problem: launch.brief.problem,
    goals: launch.brief.goals,
    measures: items,
    measuresVersion: version,
    locked,
    approvedOn,
    reviewPoints: POINTS.map((p) => ({ ...p, on: approvedOn ? addDays(approvedOn, p.days) : null })),
    reviewer: launch.createdBy?.name ?? null,
  }
}
