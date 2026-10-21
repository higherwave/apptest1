import { Hono } from 'hono'
import { ApiError, envelope } from './errors.js'
import { lazyPgDb, type Db, type Env } from './db.js'
import { requestContext } from './context.js'

export type AppOptions = { env?: Env; getDb?: () => Db }

export function createApp(options: AppOptions = {}) {
  const env: Env = options.env ?? process.env
  const getDb = options.getDb ?? lazyPgDb(env)
  const app = new Hono().basePath('/api/v1')

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.field), err.status)
    console.error(err)
    return c.json(envelope('internal_error', 'Something went wrong.'), 500)
  })
  app.notFound((c) => c.json(envelope('not_found', `No route for ${c.req.method} ${c.req.path}.`), 404))

  const withContext = requestContext({ env, getDb })

  // Liveness. Never touches the database, so uptime checks cannot wake a suspended Neon compute.
  app.get('/health', (c) =>
    c.json({ status: 'ok', time: new Date().toISOString(), version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' }),
  )

  // Reaches the database, so it needs the same access as the data routes.
  app.get('/health/db', withContext, async (c) => {
    const { rows } = await getDb().query(`select count(*)::int as migrations from public.schema_migrations`)
    return c.json({ status: 'ok', database: 'reachable', migrations: rows[0].migrations })
  })

  app.get('/me', withContext, (c) => {
    const ctx = c.get('ctx')
    return c.json({ userId: ctx.userId, email: ctx.email, displayName: ctx.displayName, workspaceId: ctx.workspaceId, workspaceName: ctx.workspaceName, role: ctx.role })
  })

  return app
}
