import { Hono, type Context } from 'hono'
import { ApiError, envelope } from './errors.js'
import { lazyPgDb, type Db, type Env } from './db.js'
import { requestContext } from './context.js'
import {
  createProject, deleteProject, getProjectDetail, getProjectStage, getProjectSummary, listProjects, listTemplates, ProjectNotFound, savePlan, saveParticipants, saveTasks,
  TemplateMissing, UnknownParticipant, VersionConflict,
} from './projects.js'
import { createProjectSchema, METHOD_OPTIONS, parseBody, saveParticipantsSchema, savePlanSchema, saveTasksSchema } from './schemas.js'

export type AppOptions = { env?: Env; getDb?: () => Db }

export function createApp(options: AppOptions = {}) {
  const env: Env = options.env ?? process.env
  const getDb = options.getDb ?? lazyPgDb(env)
  const app = new Hono().basePath('/api/v1')

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.field, err.extra), err.status)
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

  // One project -------------------------------------------------------------------------------------

  const projectId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such project.')
    return id
  }

  app.get('/projects/:id', withReadContext, async (c) => {
    const detail = await getProjectDetail(getDb(), c.get('ctx').workspaceId, projectId(c))
    if (!detail) throw new ApiError(404, 'not_found', 'No such project.')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    c.header('ETag', `"${detail.version}"`)
    return c.json(detail)
  })

  app.get('/projects/:id/stage', withReadContext, async (c) => {
    const stage = await getProjectStage(getDb(), c.get('ctx').workspaceId, projectId(c))
    if (!stage) throw new ApiError(404, 'not_found', 'No such project.')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(stage)
  })

  // Saves carry the version the person was looking at, in If-Match. If someone else saved first the
  // answer is 409 with the current version; nothing is overwritten silently.
  const expectedVersion = (c: Context) => {
    const raw = c.req.header('if-match')
    const n = raw === undefined ? NaN : Number(raw.replace(/^W\//, '').replace(/"/g, ''))
    if (!Number.isInteger(n)) throw new ApiError(428, 'precondition_required', 'Send the version you are editing in the If-Match header.')
    return n
  }
  const save = async (c: Context, schema: Parameters<typeof parseBody>[0], run: (id: string, expected: number, input: any) => Promise<void>) => {
    requireEditor(c)
    const id = projectId(c)
    const expected = expectedVersion(c)
    const input = parseBody(schema, await readJson(c))
    try {
      await run(id, expected, input)
    } catch (err) {
      if (err instanceof ProjectNotFound) throw new ApiError(404, 'not_found', 'No such project.')
      if (err instanceof VersionConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this project since you opened it.', undefined, { current: { version: err.current } })
      if (err instanceof UnknownParticipant) throw new ApiError(422, 'validation_failed', 'That participant does not belong to this project.', 'participants')
      throw err
    }
    const detail = await getProjectDetail(getDb(), c.get('ctx').workspaceId, id)
    c.header('Cache-Control', 'no-store')
    c.header('ETag', `"${detail!.version}"`)
    return c.json(detail)
  }

  app.put('/projects/:id/study', withContext, (c) => save(c, savePlanSchema, (id, v, input) => savePlan(getDb(), c.get('ctx'), id, v, input)))
  app.put('/projects/:id/participants', withContext, (c) => save(c, saveParticipantsSchema, (id, v, input) => saveParticipants(getDb(), c.get('ctx'), id, v, input)))
  app.put('/projects/:id/tasks', withContext, (c) => save(c, saveTasksSchema, (id, v, input) => saveTasks(getDb(), c.get('ctx'), id, v, input)))

  return app
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
