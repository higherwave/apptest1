import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { ApiError, envelope } from './errors.js'
import { lazyPgDb, lazyPool, type Db, type Env } from './db.js'
import { authConfigured, makeBetterAuth, type AuthService } from './auth.js'
import { AlreadyMember, changeRole, inviteMember, LastOwner, listMembers, MemberNotFound, removeMember } from './members.js'
import { requestContext } from './context.js'
import {
  createProject, deleteProject, getProjectDetail, getProjectStage, getProjectSummary, listProjects, listTemplates, ProjectNotFound, savePlan, saveTasks,
  TemplateMissing, UnknownParticipant, VersionConflict,
} from './projects.js'
import { createProjectSchema, METHOD_OPTIONS, parseBody, savePlanSchema, saveTasksSchema, saveTranscriptsSchema, THEME_CATEGORIES, themePatchSchema,
  createSpecSchema, changeRoleSchema, inviteMemberSchema, editStepSchema, includeThemeSchema, redoSchema, standaloneSpecSchema, checklistSchema, moveStorySchema, patchStorySchema } from './schemas.js'
import {
  CannotUndo, getBoard, getStory, moveStory, NoBoard, NothingToUndo, patchStory, saveChecklist, StoryNotFound, StoryVersionConflict, undoMove, UnknownChecklistItem,
} from './stories.js'
import {
  approveStep, createProjectSpec, createStandaloneSpec, deleteSpec, editStep, getSpec, listSpecs, NoAnalysis, NotAllApproved, publishSpec, redoStep, setThemeIncluded,
  SpecConflict, SpecNotFound, SpecPublished, StepConflict, StepOutOfOrder,
} from './specs.js'
import { listTranscripts, saveTranscripts, UnknownTranscript } from './transcripts.js'
import { aiMode, makeAi, monthlyBudgetUsd, spentThisMonthUsd, type AiProvider } from './ai.js'
import { NoTranscripts, runAnalysis } from './analysis.js'
import { getPlatformTheme, getThemesOverview, listCaseStudies, refreshPlatformMatches } from './insights.js'
import { getTheme, listThemes, patchTheme, resetPriorityOverrides, ThemeConflict, ThemeNotFound, ThemeSuperseded } from './themes.js'

export type AppOptions = { env?: Env; getDb?: () => Db; provider?: AiProvider; auth?: AuthService }

export function createApp(options: AppOptions = {}) {
  const env: Env = options.env ?? process.env
  const getPool = lazyPool(env)
  const getDb = options.getDb ?? lazyPgDb(env, getPool)
  const auth = options.auth ?? (authConfigured(env) ? makeBetterAuth(env, getPool) : undefined)
  const ai = makeAi(env, options.provider)
  const app = new Hono().basePath('/api/v1')

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.field, err.extra), err.status)
    console.error(err)
    return c.json(envelope('internal_error', 'Something went wrong.'), 500)
  })
  app.notFound((c) => c.json(envelope('not_found', `No route for ${c.req.method} ${c.req.path}.`), 404))

  const withContext = requestContext({ env, getDb, auth }) // strict: a signed-in person, or the token
  const withReadContext = requestContext({ env, getDb, auth }, 'read') // reads are also open to the read-only demo viewer, before sign-in exists

  // Anonymous reads may be cached by the CDN for a minute, so repeated requests never reach (or wake) the
  // database. Requests with the token are never cached.
  // With sign-in on, nothing is cached by the CDN: its cache is not keyed by cookie, so a signed-in person could be handed
  // a copy made for an anonymous visitor.
  const cacheHeaders = (c: Context) =>
    c.header('Cache-Control', c.get('ctx').anonymous && !auth ? 'public, s-maxage=60, stale-while-revalidate=300' : 'private, no-store')

  // Liveness. Never touches the database, so uptime checks cannot wake a suspended Neon compute.
  app.get('/health', (c) =>
    c.json({ status: 'ok', time: new Date().toISOString(), version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' }),
  )

  // Whether AI is live or simulated, for the header indicator. Never touches the database for the anonymous viewer; the
  // token holder also sees this month's spend against the budget.
  app.get('/ai/status', withReadContext, async (c) => {
    const ctx = c.get('ctx')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    const mode = aiMode(ai)
    if (ctx.anonymous || mode === 'simulated') return c.json({ mode, enabled: env.AI_ENABLED !== 'false' })
    return c.json({ mode, enabled: true, budgetUsd: monthlyBudgetUsd(env), spentUsd: await spentThisMonthUsd(getDb(), ctx.workspaceId) })
  })

  // Reaches the database, so it needs the same access as the data routes.
  app.get('/health/db', withContext, async (c) => {
    const { rows } = await getDb().query(`select count(*)::int as migrations from public.schema_migrations`)
    return c.json({ status: 'ok', database: 'reachable', migrations: rows[0].migrations })
  })

  app.get('/me', withReadContext, (c) => {
    const ctx = c.get('ctx')
    c.header('Cache-Control', 'private, no-store')
    return c.json({
      userId: ctx.userId, email: ctx.email, displayName: ctx.displayName, workspaceId: ctx.workspaceId, workspaceName: ctx.workspaceName, role: ctx.role, via: ctx.via,
      signInAvailable: !!auth,
    })
  })

  // Sign-in itself (the Google redirect and its callback, sign-out, the session): handled by the sign-in library.
  if (auth) app.all('/auth/*', (c) => auth.handler(c.req.raw))

  // Members: anyone in the workspace can see who is in it; only owners invite, change roles and remove.
  const requireOwner = (c: Context) => {
    if (c.get('ctx').role !== 'owner') throw new ApiError(403, 'forbidden', 'Only an owner can manage members.')
  }
  const memberId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such member.')
    return id
  }
  const memberErrors = (err: unknown): never => {
    if (err instanceof MemberNotFound) throw new ApiError(404, 'not_found', 'No such member.')
    if (err instanceof AlreadyMember) throw new ApiError(409, 'already_member', 'That person is already a member.')
    if (err instanceof LastOwner) throw new ApiError(409, 'last_owner', 'A workspace needs at least one owner.')
    throw err
  }

  app.get('/members', withContext, async (c) => {
    c.header('Cache-Control', 'private, no-store')
    return c.json({ data: await listMembers(getDb(), c.get('ctx').workspaceId) })
  })

  app.post('/members', withContext, async (c) => {
    requireOwner(c)
    const input = parseBody(inviteMemberSchema, await readJson(c))
    try {
      const member = await inviteMember(getDb(), c.get('ctx'), input)
      c.header('Cache-Control', 'no-store')
      return c.json(member, 201)
    } catch (err) {
      return memberErrors(err)
    }
  })

  app.patch('/members/:id', withContext, async (c) => {
    requireOwner(c)
    const id = memberId(c)
    const input = parseBody(changeRoleSchema, await readJson(c))
    try {
      c.header('Cache-Control', 'no-store')
      return c.json(await changeRole(getDb(), c.get('ctx'), id, input.role))
    } catch (err) {
      return memberErrors(err)
    }
  })

  app.delete('/members/:id', withContext, async (c) => {
    requireOwner(c)
    const id = memberId(c)
    try {
      await removeMember(getDb(), c.get('ctx'), id)
    } catch (err) {
      return memberErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
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
  const save = async (c: Context, schema: Parameters<typeof parseBody>[0], run: (id: string, expected: number, input: any) => Promise<unknown>, respond: 'project' | 'transcripts' | 'raw' = 'project', status: 200 | 201 = 200) => {
    requireEditor(c)
    const id = projectId(c)
    const expected = expectedVersion(c)
    const input = parseBody(schema, await readJson(c))
    let result: unknown
    try {
      result = await run(id, expected, input)
    } catch (err) {
      if (err instanceof ProjectNotFound) throw new ApiError(404, 'not_found', 'No such project.')
      if (err instanceof VersionConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this project since you opened it.', undefined, { current: { version: err.current } })
      if (err instanceof UnknownParticipant) throw new ApiError(422, 'validation_failed', 'That participant does not belong to this project.', 'participants')
      if (err instanceof UnknownTranscript) throw new ApiError(422, 'validation_failed', 'That transcript does not belong to this project.', 'transcripts')
      if (err instanceof NoTranscripts) throw new ApiError(422, 'no_transcripts', 'Add at least one transcript before analyzing.', 'transcripts')
      throw err
    }
    const detail = await getProjectDetail(getDb(), c.get('ctx').workspaceId, id)
    c.header('Cache-Control', 'no-store')
    c.header('ETag', `"${detail!.version}"`)
    if (respond === 'transcripts') return c.json(await listTranscripts(getDb(), id))
    if (respond === 'raw') return c.json(result, status)
    return c.json(detail)
  }

  app.put('/projects/:id/study', withContext, (c) => save(c, savePlanSchema, (id, v, input) => savePlan(getDb(), c.get('ctx'), id, v, input)))
  app.get('/projects/:id/transcripts', withReadContext, async (c) => {
    const id = projectId(c)
    const detail = await getProjectDetail(getDb(), c.get('ctx').workspaceId, id)
    if (!detail) throw new ApiError(404, 'not_found', 'No such project.')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    c.header('ETag', `"${detail.version}"`)
    return c.json(await listTranscripts(getDb(), id))
  })
  app.put('/projects/:id/transcripts', withContext, (c) => save(c, saveTranscriptsSchema, (id, v, input) => saveTranscripts(getDb(), c.get('ctx'), id, v, input), 'transcripts'))
  // Phase 1 runs the simulated analysis inline and answers 201 with the finished run; a real model would answer 202 and be polled.
  app.post('/projects/:id/analysis-runs', withContext, (c) =>
    save(
      c,
      z.object({}).passthrough(),
      async (id, v) => {
        const result = await runAnalysis(getDb(), ai, c.get('ctx'), id, v)
        // The simulated matcher keeps Platform Insights in step with the new themes; the analysis stands if it fails.
        await refreshPlatformMatches(getDb(), ai, c.get('ctx').workspaceId).catch(() => undefined)
        return result
      },
      'raw',
      201,
    ),
  )
  // Themes ---------------------------------------------------------------------------------------------

  app.get('/projects/:id/themes', withReadContext, async (c) => {
    const id = projectId(c)
    const detail = await getProjectDetail(getDb(), c.get('ctx').workspaceId, id)
    if (!detail) throw new ApiError(404, 'not_found', 'No such project.')
    const category = c.req.query('category')
    if (category && !(THEME_CATEGORIES as readonly string[]).includes(category)) throw new ApiError(422, 'validation_failed', 'Unknown category.', 'category')
    const data = await listThemes(getDb(), id, { category, quotes: c.req.query('include') === 'quotes' })
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data, stages: detail.stages })
  })

  // Edits are per theme: the If-Match is the version of that theme's edits (0 when it has none).
  app.patch('/themes/:id', withContext, async (c) => {
    requireEditor(c)
    const themeId = c.req.param('id')
    if (!UUID.test(themeId)) throw new ApiError(404, 'not_found', 'No such theme.')
    const expected = expectedVersion(c)
    const patch = parseBody(themePatchSchema, await readJson(c))
    try {
      await patchTheme(getDb(), c.get('ctx'), themeId, expected, patch)
    } catch (err) {
      if (err instanceof ThemeNotFound) throw new ApiError(404, 'not_found', 'No such theme.')
      if (err instanceof ThemeSuperseded) throw new ApiError(409, 'theme_superseded', 'This theme belongs to an earlier analysis. Reload to see the current themes.')
      if (err instanceof ThemeConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this theme since you opened it.', undefined, { current: { version: err.current } })
      throw err
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await getTheme(getDb(), c.get('ctx').workspaceId, themeId))
  })

  app.delete('/projects/:id/priority-overrides', withContext, async (c) => {
    requireEditor(c)
    const id = projectId(c)
    if (!(await getProjectDetail(getDb(), c.get('ctx').workspaceId, id))) throw new ApiError(404, 'not_found', 'No such project.')
    await resetPriorityOverrides(getDb(), c.get('ctx'), id)
    c.header('Cache-Control', 'no-store')
    return c.json({ data: await listThemes(getDb(), id) })
  })

  // Requirements documents --------------------------------------------------------------------------------

  // Domain errors from the specs module become the API's answers.
  const specError = (err: unknown): never => {
    if (err instanceof SpecNotFound) throw new ApiError(404, 'not_found', 'No such document.')
    if (err instanceof SpecPublished) throw new ApiError(409, 'spec_published', 'This document is published and can no longer be changed.')
    if (err instanceof NoAnalysis) throw new ApiError(409, 'no_analysis', 'Analyze the transcripts first: a document is built from the themes.')
    if (err instanceof StepOutOfOrder) throw new ApiError(409, 'step_not_ready', 'That step is not ready for this action yet.')
    if (err instanceof NotAllApproved) throw new ApiError(409, 'steps_not_approved', 'Every step must be approved before publishing.')
    if (err instanceof StepConflict || err instanceof SpecConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this since you opened it.', undefined, { current: { version: err.current } })
    throw err
  }
  const specDetail = async (c: Context, id: string) => {
    const detail = await getSpec(getDb(), c.get('ctx').workspaceId, id)
    if (!detail) throw new ApiError(404, 'not_found', 'No such document.')
    c.header('ETag', `"${detail.version}"`)
    return detail
  }
  const specId = (c: Context, name = 'id') => {
    const id = c.req.param(name) ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such document.')
    return id
  }

  app.get('/specs', withReadContext, async (c) => {
    const projectId = c.req.query('projectId')
    if (projectId && !UUID.test(projectId)) throw new ApiError(422, 'validation_failed', 'Not a project id.', 'projectId')
    const data = await listSpecs(getDb(), c.get('ctx').workspaceId, { projectId, standalone: c.req.query('standalone') === 'true' })
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data })
  })

  app.post('/projects/:id/specs', withContext, async (c) => {
    requireEditor(c)
    const id = projectId(c)
    const input = parseBody(createSpecSchema, await readJson(c))
    let created: string
    try {
      created = await createProjectSpec(getDb(), ai, c.get('ctx'), id, input.name)
    } catch (err) {
      return specError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await specDetail(c, created), 201)
  })

  app.post('/specs/standalone', withContext, async (c) => {
    requireEditor(c)
    const input = parseBody(standaloneSpecSchema, await readJson(c))
    const created = await createStandaloneSpec(getDb(), ai, c.get('ctx'), input)
    c.header('Cache-Control', 'no-store')
    return c.json(await specDetail(c, created), 201)
  })

  app.get('/specs/:id', withReadContext, async (c) => {
    const detail = await specDetail(c, specId(c))
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(detail)
  })

  app.put('/specs/:id/themes/:themeId', withContext, async (c) => {
    requireEditor(c)
    const id = specId(c)
    const themeId = specId(c, 'themeId')
    const expected = expectedVersion(c)
    const { included } = parseBody(includeThemeSchema, await readJson(c))
    try {
      await setThemeIncluded(getDb(), c.get('ctx'), id, themeId, included, expected)
    } catch (err) {
      return specError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await specDetail(c, id))
  })

  // A step action carries the version of that step, so two people reviewing the same step cannot both succeed.
  const stepAction = async (c: Context, schema: Parameters<typeof parseBody>[0] | null, run: (stepId: string, expected: number, input: any) => Promise<string>) => {
    requireEditor(c)
    const stepId = specId(c)
    const expected = expectedVersion(c)
    const input = schema ? parseBody(schema, await readJson(c)) : undefined
    let id: string
    try {
      id = await run(stepId, expected, input)
    } catch (err) {
      return specError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await specDetail(c, id))
  }
  app.post('/agent-steps/:id/approve', withContext, (c) => stepAction(c, null, (stepId, v) => approveStep(getDb(), ai, c.get('ctx'), stepId, v)))
  app.post('/agent-steps/:id/redo', withContext, (c) => stepAction(c, redoSchema, (stepId, v, input) => redoStep(getDb(), ai, c.get('ctx'), stepId, v, input.instructions)))
  app.patch('/agent-steps/:id', withContext, (c) => stepAction(c, editStepSchema, (stepId, v, input) => editStep(getDb(), c.get('ctx'), stepId, v, input.text)))

  app.post('/specs/:id/publish', withContext, async (c) => {
    requireEditor(c)
    const id = specId(c)
    let result
    try {
      result = await publishSpec(getDb(), c.get('ctx'), id, expectedVersion(c))
    } catch (err) {
      return specError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ specId: id, ...result }, 201)
  })

  app.delete('/specs/:id', withContext, async (c) => {
    requireEditor(c)
    if (!(await deleteSpec(getDb(), c.get('ctx'), specId(c)))) throw new ApiError(404, 'not_found', 'No such document.')
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })

  // The Stories board ---------------------------------------------------------------------------------------

  const storyError = (err: unknown): never => {
    if (err instanceof StoryNotFound) throw new ApiError(404, 'not_found', 'No such story.')
    if (err instanceof StoryVersionConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this card since you opened it.', undefined, { current: { version: err.current } })
    if (err instanceof NothingToUndo) throw new ApiError(404, 'nothing_to_undo', 'There is no move of yours to undo.')
    if (err instanceof CannotUndo) throw new ApiError(409, 'cannot_undo', 'That card has been moved again since, so the move cannot be undone.')
    if (err instanceof UnknownChecklistItem) throw new ApiError(422, 'validation_failed', 'That checklist item does not belong to this card.', 'items')
    throw err
  }

  app.get('/projects/:id/board', withReadContext, async (c) => {
    const id = projectId(c)
    const ctx = c.get('ctx')
    if (!(await getProjectDetail(getDb(), ctx.workspaceId, id))) throw new ApiError(404, 'not_found', 'No such project.')
    let board
    try {
      board = await getBoard(getDb(), ctx.workspaceId, id, ctx.anonymous ? null : ctx.userId)
    } catch (err) {
      if (err instanceof NoBoard) throw new ApiError(404, 'no_board', 'There is no board yet. Publish a requirements document to create one.')
      throw err
    }
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(board)
  })

  // Platform Insights ------------------------------------------------------------------------------------

  app.get('/insights/themes', withReadContext, async (c) => {
    const body = await getThemesOverview(getDb(), c.get('ctx').workspaceId)
    cacheHeaders(c)
    return c.json(body)
  })
  app.get('/insights/themes/:id', withReadContext, async (c) => {
    const id = c.req.param('id') ?? ''
    const theme = UUID.test(id) ? await getPlatformTheme(getDb(), c.get('ctx').workspaceId, id) : undefined
    if (!theme) throw new ApiError(404, 'not_found', 'No such platform theme.')
    cacheHeaders(c)
    return c.json(theme)
  })
  app.get('/insights/case-studies', withReadContext, async (c) => {
    const data = await listCaseStudies(getDb(), c.get('ctx').workspaceId)
    cacheHeaders(c)
    return c.json({ data })
  })

  const storyId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such story.')
    return id
  }
  const storyDetail = async (c: Context, id: string) => {
    const story = await getStory(getDb(), c.get('ctx').workspaceId, id)
    if (!story) throw new ApiError(404, 'not_found', 'No such story.')
    return story
  }

  app.get('/stories/:id', withReadContext, async (c) => {
    const story = await storyDetail(c, storyId(c))
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    c.header('ETag', `"${story.version}"`)
    return c.json(story)
  })

  // A card action carries the version of that card, so two people changing the same card cannot both succeed.
  const storyAction = async (c: Context, schema: Parameters<typeof parseBody>[0], run: (id: string, expected: number, input: any) => Promise<void>) => {
    requireEditor(c)
    const id = storyId(c)
    const expected = expectedVersion(c)
    const input = parseBody(schema, await readJson(c))
    try {
      await run(id, expected, input)
    } catch (err) {
      return storyError(err)
    }
    const story = await storyDetail(c, id)
    c.header('Cache-Control', 'no-store')
    c.header('ETag', `"${story.version}"`)
    return c.json(story)
  }
  app.post('/stories/:id/move', withContext, (c) => storyAction(c, moveStorySchema, (id, v, input) => moveStory(getDb(), c.get('ctx'), id, v, { status: input.status, beforeId: input.beforeId })))
  app.patch('/stories/:id', withContext, (c) => storyAction(c, patchStorySchema, (id, v, input) => patchStory(getDb(), c.get('ctx'), id, v, input)))
  app.put('/stories/:id/checklist', withContext, (c) => storyAction(c, checklistSchema, (id, v, input) => saveChecklist(getDb(), c.get('ctx'), id, v, input.items)))

  app.post('/specs/:id/undo', withContext, async (c) => {
    requireEditor(c)
    let id: string
    try {
      id = await undoMove(getDb(), c.get('ctx'), specId(c))
    } catch (err) {
      return storyError(err)
    }
    const story = await storyDetail(c, id)
    c.header('Cache-Control', 'no-store')
    return c.json(story)
  })

  app.put('/projects/:id/tasks', withContext, (c) => save(c, saveTasksSchema, (id, v, input) => saveTasks(getDb(), c.get('ctx'), id, v, input)))

  return app
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
