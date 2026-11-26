// Puts the Anchor CX studies back on the Anchor CX example workflow, so Platform Insights > Journeys shows their research (personas, themes, pain points,
// opportunities and sentiment) over the blueprint. Reloading the demo (db/seed/anchor-cx.mjs) recreates the studies, and they come back on no workflow.
//
//   npx tsx scripts/demo-workflow-link.ts            dry run: says which studies it would put on the workflow, writes nothing
//   npx tsx scripts/demo-workflow-link.ts --yes      does it
//
// Safe to run again: only studies that are on no workflow and whose journey stages all match the workflow's stages by name are touched, and it creates the example
// workflow if it is missing. Nothing is deleted. The same thing is done by the "Add the Anchor CX example" request (POST /workflows/sample).
// @ts-expect-error the migration helpers are plain .mjs with no types
import { loadEnvFile } from '../db/migrate.mjs'
import { findConnectionString, lazyPgDb, type Db } from '../server/db.js'
import type { RequestContext } from '../server/context.js'
import { linkSampleStudies } from '../server/workflows.js'

class DryRun extends Error {
  constructor(public linked: string[]) {
    super('dry run')
  }
}

export async function linkDemoStudies(db: Db, slug: string, apply: boolean): Promise<string[]> {
  const ws = (await db.query('select id from core.workspaces where slug = $1', [slug])).rows[0]
  if (!ws) throw new Error(`No workspace "${slug}".`)
  const wdb = db.inWorkspace(ws.id)
  const owner = (await wdb.query(`select user_id from core.memberships where workspace_id = $1 and role = 'owner' and not is_external order by created_at limit 1`, [ws.id])).rows[0]
  const ctx = { workspaceId: ws.id, userId: owner?.user_id ?? null } as unknown as RequestContext
  try {
    // A dry run does the work inside a transaction and rolls it back.
    return await wdb.transaction(async (tx) => {
      const linked = await linkSampleStudies(tx, ctx)
      if (!apply) throw new DryRun(linked)
      return linked
    })
  } catch (err) {
    if (err instanceof DryRun) return err.linked
    throw err
  }
}

if (process.argv[1] && process.argv[1].endsWith('demo-workflow-link.ts')) {
  const apply = process.argv.includes('--yes')
  loadEnvFile()
  const env = process.env as Record<string, string | undefined>
  const url = findConnectionString(env)
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).')
    process.exit(1)
  }
  const slug = env.WORKSPACE_SLUG || env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
  console.log(`Target: ${new URL(url).host}, workspace "${slug}"${apply ? '' : '  (dry run: nothing is written)'}`)
  linkDemoStudies(lazyPgDb(env)(), slug, apply)
    .then((linked) => {
      if (!linked.length) console.log('  Nothing to do: every study that fits the example workflow is already on it.')
      linked.forEach((n) => console.log(`  ${apply ? 'put on the workflow' : 'would put on the workflow'}: ${n}`))
      console.log(apply ? `Done: ${linked.length} ${linked.length === 1 ? 'study' : 'studies'} linked.` : 'Dry run only. Run again with --yes to apply.')
      process.exit(0)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
