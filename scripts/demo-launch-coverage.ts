// Makes the Anchor CX "Health score trust" launch a happy-path demo: invented approvers for Sales, Legal and Documentation, each with a recorded answer.
//
//   npx tsx scripts/demo-launch-coverage.ts                 dry run: reads only, says what it would do
//   npx tsx scripts/demo-launch-coverage.ts --yes           does it, step by step through the app's own functions
//   npx tsx scripts/demo-launch-coverage.ts --project "Name" --yes     another project's launch
//
// The people are invented and live on addresses ending .example, which Signal Flow never emails (server/launch-notices.ts), so nothing reaches an inbox.
// Approvers are set with saveApprovalStep and answers are recorded with answerStep, as each person, so every rule in the app applies and the audit log
// shows it as it would be. Safe to run again: a step that already has an approver keeps them, and a step that already has an answer is left alone.
// It never touches the other steps (Product leadership, Marketing, Final decision) or any other project.
// @ts-expect-error the migration helpers are plain .mjs with no types
import { loadEnvFile } from '../db/migrate.mjs'
import { findConnectionString, lazyPgDb, type Db } from '../server/db.js'
import { contextForUser } from '../server/context.js'
import { approvalsOverview, saveApprovalStep } from '../server/reviewers.js'
import { answerStep, getProjectLaunch } from '../server/launches.js'

export type DemoStep = { step: 'sales' | 'legal' | 'documentation'; email: string; name: string; answer: 'ready' | 'ready_with_conditions'; rationale: string }

// Anchor CX is the demo story (never tailored to a viewer's domain). The health score work is the happy path: every function says it is ready.
export const DEMO_STEPS: DemoStep[] = [
  {
    step: 'sales',
    email: 'priya.nair@anchorcx.example',
    name: 'Priya Nair',
    answer: 'ready',
    rationale: 'The account health change is easy to explain to customers: the score now shows the risk factors behind it. Our renewal managers have the talking points and a one-page FAQ, and no deal in the next quarter depends on the old score.',
  },
  {
    step: 'legal',
    email: 'daniel.osei@anchorcx.example',
    name: 'Daniel Osei',
    answer: 'ready',
    rationale: 'The change uses only data customers already agreed to share, so no new terms or data-processing changes are needed. The release notes avoid promising accuracy figures. Nothing here holds the launch back.',
  },
  {
    step: 'documentation',
    email: 'mei.tanaka@anchorcx.example',
    name: 'Mei Tanaka',
    answer: 'ready',
    rationale: 'The help-center article on how the health score is calculated is rewritten, the new risk-factor panel is documented with screenshots, and the in-app tooltip text is final.',
  },
]

export type Report = { project: string; launchId: string | null; lines: string[]; changed: boolean }

/** Does (or, with apply false, only reports) the work for one project's launch. `db` is the owner-level database. */
export async function fillDemoLaunch(db: Db, slug: string, projectName: string, apply: boolean, steps: DemoStep[] = DEMO_STEPS): Promise<Report> {
  const lines: string[] = []
  const say = (s: string) => lines.push(s)
  const ws = (await db.query('select id, name from core.workspaces where slug = $1', [slug])).rows[0]
  if (!ws) throw new Error(`No workspace "${slug}".`)
  const owner = (await db.query(`select user_id from core.memberships where workspace_id = $1 and role = 'owner' and not is_external order by created_at limit 1`, [ws.id])).rows[0]
  if (!owner) throw new Error('The workspace has no owner to act as.')
  const ownerCtx = await contextForUser(db.inWorkspace(ws.id), ws.id, owner.user_id)
  if (!ownerCtx) throw new Error('Could not act as the workspace owner.')
  const wdb = db.inWorkspace(ws.id)

  const project = (await wdb.query('select id from core.projects where name = $1', [projectName])).rows[0]
  if (!project) throw new Error(`No project named "${projectName}" in workspace "${slug}".`)
  const found = await getProjectLaunch(wdb, ownerCtx, project.id)
  if (!found.launch) {
    say(`"${projectName}" has no launch yet: start one from its Launch step first (the requirements must be published), then run this again.`)
    return { project: projectName, launchId: null, lines, changed: false }
  }
  const launchId = found.launch.id
  say(`Launch "${found.launch.name}" (${found.launch.stage}) in workspace "${ws.name}".`)

  let changed = false
  const overview = await approvalsOverview(wdb, ws.id)
  const memberOf = async (email: string) => (await wdb.query('select m.user_id from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and lower(u.email) = $2', [ws.id, email])).rows[0]?.user_id as string | undefined

  for (const s of steps) {
    const current = overview.steps.find((x) => x.key === s.step)
    if (current?.approver) {
      say(`${s.step}: already has an approver (${current.approver.name}); leaving the approver alone.`)
    } else {
      let userId = await memberOf(s.email)
      say(`${s.step}: ${userId ? 'would use the existing member' : 'would add the invented member'} ${s.name} <${s.email}> as approver.`)
      if (apply) {
        if (!userId) {
          // A person is found or made by email through the database's own function; the membership is an ordinary editor.
          userId = (await wdb.query('select core.user_id_for_email($1, $2) as id', [s.email, s.name])).rows[0].id as string
          await wdb.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'editor') on conflict (workspace_id, user_id) do nothing`, [ws.id, userId])
        }
        // Keep each team's setting for the step as it is (for example "not used"); only the workspace approver is added.
        const teams = Object.fromEntries((current?.teams ?? []).map((t) => [t.teamId, t.mode === 'custom' ? { mode: 'custom' as const, approver: t.approver?.userId ?? null, backup: t.backup?.userId ?? null } : { mode: t.mode }]))
        await saveApprovalStep(wdb, ownerCtx, s.step, { approver: userId, backup: current?.backup?.userId ?? null, teams })
        changed = true
      }
    }

    const approverId = apply ? await memberOf(s.email) : undefined
    const answered = (await wdb.query('select 1 from delivery.launch_answers where launch_id = $1 and step = $2 limit 1', [launchId, s.step])).rows.length > 0
    if (answered) say(`${s.step}: already answered; leaving it.`)
    else {
      say(`${s.step}: would record "${s.answer}" as ${s.name}.`)
      if (apply && approverId) {
        const ctx = await contextForUser(wdb, ws.id, approverId)
        if (!ctx) throw new Error(`${s.name} is not a member.`)
        await answerStep(wdb, ctx, launchId, s.step, { answer: s.answer, rationale: s.rationale })
        changed = true
      }
    }
  }
  return { project: projectName, launchId, lines, changed }
}

if (process.argv[1] && process.argv[1].endsWith('demo-launch-coverage.ts')) {
  const args = process.argv.slice(2)
  const apply = args.includes('--yes')
  const at = args.indexOf('--project')
  const projectName = at >= 0 ? args[at + 1] : 'Health score trust'
  loadEnvFile()
  const env = process.env as Record<string, string | undefined>
  const url = findConnectionString(env)
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).')
    process.exit(1)
  }
  const slug = env.WORKSPACE_SLUG || env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
  console.log(`Target: ${new URL(url).host}, workspace "${slug}", project "${projectName}"${apply ? '' : '  (dry run: nothing is written)'}`)
  const db = lazyPgDb(env)()
  fillDemoLaunch(db, slug, projectName, apply)
    .then((r) => {
      r.lines.forEach((l) => console.log('  ' + l))
      console.log(apply ? (r.changed ? 'Done.' : 'Nothing to change.') : 'Dry run only. Run again with --yes to apply.')
      process.exit(0)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
