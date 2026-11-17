// "How will we know it worked?": a launch's success view, read-only for now. It gathers what is already known: the goals from the product brief, the measure of each
// requirement with its latest reading (from Measure), and when to look (review points counted from the launch's target date). Measures are kept by requirement, the way
// everything else is: a requirement's measure can draw on several kinds of signal (analytics, support, what people say), and the reading is judged together.
import type { Queryable } from './db.js'
import { launchForSystem } from './launches.js'
import { getMeasure, type MeasureItem } from './measure.js'

export type ReviewPoint = { key: string; label: string; days: number; on: string | null }
export type LaunchSuccess = {
  published: boolean
  projectId: string
  problem: string | null
  goals: string[] | null
  measures: MeasureItem[]
  reviewPoints: ReviewPoint[]
  reviewer: string | null
}

const POINTS = [
  { key: 'launch', label: 'Launch', days: 0 },
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
  const measures = launch.brief.published ? (await getMeasure(db, workspaceId, launch.projectId).catch(() => null))?.items ?? [] : []
  return {
    published: launch.brief.published,
    projectId: launch.projectId,
    problem: launch.brief.problem,
    goals: launch.brief.goals,
    measures,
    reviewPoints: POINTS.map((p) => ({ ...p, on: launch.targetDate ? addDays(launch.targetDate, p.days) : null })),
    reviewer: launch.createdBy?.name ?? null,
  }
}
