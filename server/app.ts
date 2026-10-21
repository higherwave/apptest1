import { Hono, type Context } from 'hono'
import { ApiError, envelope } from './errors.js'
import { lazyPgDb, type Db, type Env } from './db.js'
import { requestContext } from './context.js'
import { createProject, deleteProject, getProjectSummary, listProjects, listTemplates, TemplateMissing } from './projects.js'
import { createProjectSchema, METHOD_OPTIONS, parseBody } from './schemas.js'

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

  const withContext = requestContext({ env, getDb }) // strict: needs the token
  const withReadContext = requestContext({ env, getDb }, 'read') // reads are open to the read-only demo viewer

  // Anonymous reads may be cached by the CDN for a minute, so repeated requests never reach (or wake) the
  // database. Requests with the token are never cached.
  const cacheHeaders = (c: Context) =>
    c.header('Cache-Control', c.get('ctx').anonymous ? 'public, s-maxage=60, stale-while-revalidate=300' : 'private, no-store')

  // Liveness. Never touches the database, so uptime checks cannot wake a suspended Neon compute.
  app.get('/health', (c) =>
    c.json({ status: 'ok', time: new Date().toISOString(), version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' }),
  )

  // Reaches the database, so it needs the same access as the data routes.
  app.get('/health/db', withContext, async (c) => {
    const { rows } = await getDb().query(`select count(*)::int as migrations from public.schema_migrations`)
    return c.json({ status: 'ok', database: 'reachable', migrations: rows[0].migrations })
  })

  app.get('/me', withReadContext, (c) => {
    const ctx = c.get('ctx')
    c.header('Cache-Control', 'private, no-store')
    return c.json({ userId: ctx.userId, email: ctx.email, displayName: ctx.displayName, workspaceId: ctx.workspaceId, workspaceName: ctx.workspaceName, role: ctx.role })
  })

  app.get('/projects', withReadContext, async (c) => {
    const data = await listProjects(getDb(), c.get('ctx').workspaceId)
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data, next_cursor: null })
  })

  app.get('/templates', withReadContext, async (c) => {
    const data = await listTemplates(getDb(), c.get('ctx').workspaceId)
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data, methodOptions: METHOD_OPTIONS })
  })

  // Writes: the token is required (strict context) and the role must be able to edit.
  const requireEditor = (c: Context) => {
    const role = c.get('ctx').role
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden', 'Your role cannot make changes.')
  }
  const readJson = async (c: Context) => {
    try {
      return await c.req.json()
    } catch {
      throw new ApiError(400, 'invalid_json', 'The request body must be valid JSON.')
    }
  }

  app.post('/projects', withContext, async (c) => {
    requireEditor(c)
    const ctx = c.get('ctx')
    const input = parseBody(createProjectSchema, await readJson(c))
    let id: string
    try {
      id = await createProject(getDb(), ctx, input)
    } catch (err) {
      if (err instanceof TemplateMissing) throw new ApiError(422, 'validation_failed', 'That template does not exist in this workspace.', 'templateKey')
      throw err
    }
    const summary = await getProjectSummary(getDb(), ctx.workspaceId, id)
    c.header('Cache-Control', 'no-store')
    return c.json(summary, 201)
  })

  app.delete('/projects/:id', withContext, async (c) => {
    requireEditor(c)
    const id = c.req.param('id')
    const found = UUID.test(id) && (await deleteProject(getDb(), c.get('ctx'), id))
    if (!found) throw new ApiError(404, 'not_found', 'No such project.')
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })

  return app
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
