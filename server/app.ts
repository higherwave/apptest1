import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { ApiError, envelope } from './errors.js'
import { lazyPgDb, lazyPool, type Db, type Env } from './db.js'
import { authConfigured, makeBetterAuth, type AuthService } from './auth.js'
import { signInOptions, ssoPolicy } from './sso.js'
import { AlreadyMember, changeRole, ExternalNeedsViewer, inviteMember, LastOwner, listMembers, MemberNotFound, removeMember, setExternal } from './members.js'
import { noticeAnswered, requestAnswers, sweepLaunch, sweepLaunches } from './launch-notices.js'
import { addLink, answerStep, BadAnswer, BadLink, createLaunch, getLaunch, getProjectLaunch, LaunchExists, LaunchNotFound, LinkNotFound, listLaunches, NeedsRationale, NoThemes, NotTheReviewer, removeLink, setUpLaunch, StepNotUsed } from './launches.js'
import { addReviewer, BadStep, ExternalAllTeams, PrimaryTaken, removeReviewer, ReviewerNotFound, reviewerOverview, setTeamSteps } from './reviewers.js'
import { requestContext } from './context.js'
import { getMailer, type Mailer } from './mailer.js'
import { startThread } from './launch-slack.js'
import { cleanChannel, makeSlack, type SlackClient } from './slack.js'
import { DIGEST, runDigest, unsubscribeValid, validTimeZone } from './notifications.js'
import { timingSafeEqual } from 'node:crypto'
import {
  createProject, deleteProject, getProjectDetail, getProjectStage, getProjectSummary, listProjects, listTemplates, ProjectNotFound, savePlan, saveTasks,
  TemplateMissing, UnknownParticipant, VersionConflict,
} from './projects.js'
import { createProjectSchema, METHOD_OPTIONS, parseBody, savePlanSchema, saveTasksSchema, saveTranscriptsSchema, THEME_CATEGORIES, themePatchSchema,
  createSpecSchema, changeRoleSchema, teamMemberRoleSchema, teamNameSchema, inviteMemberSchema, notificationPrefsSchema, editStepSchema, includeThemeSchema, boardSyncSchema, redoSchema, standaloneSpecSchema, checklistSchema, captureSchema, themeAreaSchema, createAreaSchema, acceptProposalSchema, dismissProposalSchema, updateAreaSchema, mergeAreaSchema, designSchema, measureSchema, createLaunchSchema, setUpLaunchSchema, launchAnswerSchema, launchLinkSchema, teamSlackSchema, addReviewerSchema, teamStepsSchema, moveStorySchema, patchStorySchema, createTicketSchema, workflowSchema, projectWorkflowSchema, mapStageSchema } from './schemas.js'
import {
  CannotUndo, getBoard, getStory, moveStory, NoBoard, NothingToUndo, patchStory, saveChecklist, StoryNotFound, StoryVersionConflict, undoMove, UnknownChecklistItem,
} from './stories.js'
import { AlreadySent, createTicket, listTickets, NoStory, NotTicketable, RecordFailed } from './tickets.js'
import { jiraConfig, makeJira, NOT_CONNECTED, type JiraFetch } from './jira.js'
import {
  approveStep, draftWaitingStep, syncBoard, createProjectSpec, createStandaloneSpec, deleteSpec, editStep, getSpec, listSpecs, NoAnalysis, NotAllApproved, publishSpec, redoStep, setThemeIncluded,
  NotPublished, SpecConflict, SpecNotFound, SpecPublished, StepConflict, StepOutOfOrder,
} from './specs.js'
import { listTranscripts, saveTranscripts, UnknownTranscript } from './transcripts.js'
import { getCaseBrief, listCaseBriefs } from './case-briefs.js'
import { generateStoryboard, getStoryboard, NoStoryboardProject, NoThemesYet } from './storyboard.js'
import { getCustomers } from './customers.js'
import { getPlatformJourney, getWorkflowJourney } from './journey.js'
import { addSampleWorkflows, createWorkflow, deleteWorkflow, listWorkflows, mapProjectStage, projectBlueprint, sampleMissing, saveWorkflow, setProjectWorkflow, StageMissing, WorkflowConflict, WorkflowDuplicate, WorkflowMissing } from './workflows.js'
import { getUsage } from './usage.js'
import { AUDIT_GROUPS, BadCursor, listAudit, type AuditGroup } from './audit.js'
import { MeasureConflict, getMeasure, getMeasureAcross, getMeasureItem, saveMeasureItem } from './measure.js'
import { acceptProposal, dismissProposal, ProposalMissing, proposeAreas } from './area-proposals.js'
import { AreaConflict, AreaDuplicate, AreaMissing, AreaSimilar, createArea, listAreas, mergeAreas, retireArea, updateArea } from './areas.js'
import { CaptureError, capturePreflight, makeCapture, type CaptureService } from './capture.js'
import { DesignChanged, DesignConflict, getDesign, getDesignImage, getDesignItem, saveCapturedImage, saveDesignItem } from './design.js'
import { aiMode, makeAi, recentAiProblems, monthlyBudgetUsd, spendByTeam, spentThisMonthUsd, spendLevel, type AiProvider } from './ai.js'
import { NoTranscripts, runAnalysis } from './analysis.js'
import { getPlatformTheme, getThemesOverview, listCaseStudies, markThemeReviewed, refreshPlatformMatches } from './insights.js'
import { acceptSuggestion, AlreadyAssigned, assignThemeArea, clearThemeArea, NotFiledByHand, autoMergeDuplicates, dismissSuggestion, DuplicateTitle, findMergeSuggestions, listMerges, MergeHistoryMissing, mergeThemes, PlatformThemeMissing, renameTheme, SameTheme, undoMerge, writeRankRationales } from './platform-themes.js'
import { editableTeamIds, enforceProjectScope, newProjectTeam, visibleTeamIds } from './teams.js'
import { createTeam, deleteTeam, listTeams, moveProject, PersonNotInWorkspace, ProjectNotFound as TeamProjectNotFound, removeTeamMember, renameTeam, setTeamMember, setTeamSlackChannel, TeamIsDefault, TeamNameTaken, TeamNotEmpty, TeamNotFound } from './team-admin.js'
import { getTheme, listThemes, patchTheme, setThemeArea, resetPriorityOverrides, ThemeConflict, ThemeNotFound, ThemeSuperseded } from './themes.js'

export type AppOptions = { env?: Env; getDb?: () => Db; provider?: AiProvider; auth?: AuthService; capture?: CaptureService | null; mailer?: Mailer; jiraFetch?: JiraFetch; slack?: SlackClient }

export function createApp(options: AppOptions = {}) {
  const env: Env = options.env ?? process.env
  const getPool = lazyPool(env)
  const getDb = options.getDb ?? lazyPgDb(env, getPool)
  const auth = options.auth ?? (authConfigured(env) ? makeBetterAuth(env, getPool) : undefined)
  const ai = makeAi(env, options.provider)
  const mailer = options.mailer ?? getMailer(env)
  const slack = options.slack ?? makeSlack(env)
  // null while any JIRA_* setting is missing: the Jira hand-off then stays simulated.
  const jiraSettings = jiraConfig(env)
  const jira = jiraSettings ? makeJira(jiraSettings, options.jiraFetch) : null
  // null switches capture off (a test); undefined builds the real one. DESIGN_CAPTURE=false switches it off at request time.
  const capture = options.capture === null ? undefined : options.capture ?? makeCapture(env)
  const captureOn = () => !!capture && env.DESIGN_CAPTURE !== 'false'
  const app = new Hono().basePath('/api/v1')

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.field, err.extra), err.status)
    console.error(err)
    return c.json(envelope('internal_error', 'Something went wrong.'), 500)
  })
  app.notFound((c) => c.json(envelope('not_found', `No route for ${c.req.method} ${c.req.path}.`), 404))

  // The request's identity, then the team check: a route that names a project (or a theme, document, story or step of one) is refused as
  // not found when the project is another team's, and refused as forbidden for a write when the caller may only read in that team.
  const EXTERNAL_MAY_CALL = /^\/(me|launches(\/.*)?)$/
  const inTeams = (identity: MiddlewareHandler): MiddlewareHandler => async (c, next) => {
    await identity(c, async () => {})
    // An external member (outside counsel, a partner) may use only what is made for them: their own details and the launches they are asked to review
    // (which answer 404 for any launch that is not theirs).
    if (c.get('ctx').external && !EXTERNAL_MAY_CALL.test(c.req.path.replace(/^\/api\/v1/, ''))) {
      throw new ApiError(403, 'external_member', 'Your access is limited to the launches you are asked to review.')
    }
    await enforceProjectScope(getDb(), c.get('ctx'), c.req.method, c.req.path.replace(/^\/api\/v1/, ''))
    await next()
  }
  const withContext = inTeams(requestContext({ env, getDb, auth })) // strict: a signed-in person, or the token
  const withReadContext = inTeams(requestContext({ env, getDb, auth }, 'read')) // reads are also open to the read-only demo viewer, before sign-in exists

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

  // Whether thumbnails from links can work on this deployment, step by step (see capturePreflight). Public and read-only: it visits no
  // address and touches no data, and its answer is cached for five minutes.
  app.get('/health/capture', async (c) => {
    c.header('Cache-Control', 'public, s-maxage=300')
    return c.json(await capturePreflight(env))
  })

  // Whether AI is live or simulated, for the header indicator. Never touches the database for the anonymous viewer; the
  // token holder also sees this month's spend against the budget.
  app.get('/ai/status', withReadContext, async (c) => {
    const ctx = c.get('ctx')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    const mode = aiMode(ai)
    // Only owners see how the AI is running (what recently went wrong, and the spend against the budget): it is the App Status tab in Settings.
    const owner = !ctx.anonymous && ctx.role === 'owner'
    const found = owner ? await recentAiProblems(getDb(), ctx.workspaceId).catch(() => []) : []
    const lastProblem = found.length ? { problems: found } : {}
    if (!owner || mode === 'simulated') return c.json({ mode, enabled: env.AI_ENABLED !== 'false', ...lastProblem })
    const budgetUsd = monthlyBudgetUsd(env)
    const spentUsd = await spentThisMonthUsd(getDb(), ctx.workspaceId)
    // spendLevel is what the alerts follow: half (50%), high (80%) or reached (100%) of the month's budget. month says which month it counts.
    const byTeam = await spendByTeam(getDb(), ctx.workspaceId).catch(() => [])
    return c.json({ mode, enabled: true, budgetUsd, spentUsd, spendLevel: spendLevel(spentUsd, budgetUsd), month: new Date().toISOString().slice(0, 7), byTeam, ...lastProblem })
  })

  // Reaches the database, so it needs the same access as the data routes.
  app.get('/health/db', withContext, async (c) => {
    const { rows } = await getDb().query(`select count(*)::int as migrations from public.schema_migrations`)
    return c.json({ status: 'ok', database: 'reachable', migrations: rows[0].migrations })
  })

  app.get('/me', withReadContext, async (c) => {
    const ctx = c.get('ctx')
    const teamIds = Object.keys(ctx.teams)
    const teams = teamIds.length ? (await getDb().query(`select id, name from core.teams where workspace_id = $1 and id = any($2::uuid[]) order by lower(name)`, [ctx.workspaceId, teamIds])).rows.map((t) => ({ id: t.id as string, name: t.name as string, role: ctx.teams[t.id as string] })) : []
    c.header('Cache-Control', 'private, no-store')
    return c.json({
      userId: ctx.userId, email: ctx.email, displayName: ctx.displayName, avatarUrl: ctx.avatarUrl, workspaceId: ctx.workspaceId, workspaceName: ctx.workspaceName, role: ctx.role, via: ctx.via, external: ctx.external,
      signInAvailable: !!auth,
      rolesManagedBySso: ssoPolicy(env).managedByGroups,
      teamsManagedBySso: !!ssoPolicy(env).teamGroupPrefix,
      teams,
    })
  })

  // How to sign in on this deployment, for the sign-in screen. Public (a person with no session has to reach it) and reads no
  // data: only which providers are switched on and the name to show for the company one.
  app.get('/sign-in-options', (c) => {
    c.header('Cache-Control', 'public, max-age=60')
    return c.json({ data: auth ? signInOptions(env) : [] })
  })

  // Sign-in itself (the Google redirect and its callback, sign-out, the session): handled by the sign-in library.
  if (auth) app.all('/auth/*', (c) => auth.handler(c.req.raw))

  // Members: anyone in the workspace can see who is in it; only owners invite, change roles and remove.
  const requireOwner = (c: Context) => {
    if (c.get('ctx').role !== 'owner') throw new ApiError(403, 'forbidden', 'Only an owner can manage members.')
    // With SSO_*_GROUPS the identity provider decides roles at every sign-in, so a change made here would be undone.
    if (ssoPolicy(env).managedByGroups) throw new ApiError(409, 'managed_by_sso', 'Roles come from your sign-in groups. Change them in your identity provider.')
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
    if (err instanceof ExternalNeedsViewer) throw new ApiError(409, 'external_needs_viewer', 'An external member is a viewer. Change the role to viewer first.')
    throw err
  }

  app.get('/members', withContext, async (c) => {
    if (c.get('ctx').role !== 'owner') throw new ApiError(403, 'forbidden', 'Only an owner can see the members.')
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
      let member
      if (input.role !== undefined) member = await changeRole(getDb(), c.get('ctx'), id, input.role)
      if (input.external !== undefined) member = await setExternal(getDb(), c.get('ctx'), id, input.external)
      return c.json(member!)
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

  // Teams: leaders (workspace owners) manage them. Everyone else learns their own teams from /me.
  const requireLeader = (c: Context, what = 'teams') => {
    if (c.get('ctx').role !== 'owner') throw new ApiError(403, 'forbidden', `Only an owner can manage ${what}.`)
  }
  const teamErrors = (err: unknown): never => {
    if (err instanceof TeamNotFound) throw new ApiError(404, 'not_found', 'No such team.')
    if (err instanceof TeamNameTaken) throw new ApiError(409, 'team_name_taken', 'A team with that name already exists.', 'name')
    if (err instanceof TeamIsDefault) throw new ApiError(409, 'team_is_default', 'The default team cannot be deleted.')
    if (err instanceof TeamNotEmpty) throw new ApiError(409, 'team_has_projects', 'Move the team’s projects to another team first.')
    if (err instanceof PersonNotInWorkspace) throw new ApiError(404, 'not_found', 'No such member.')
    if (err instanceof TeamProjectNotFound) throw new ApiError(404, 'not_found', 'No such project.')
    throw err
  }
  const teamId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such team.')
    return id
  }
  const oneTeam = async (c: Context, id: string) => {
    const team = (await listTeams(getDb(), c.get('ctx').workspaceId)).find((t) => t.id === id)
    if (!team) throw new ApiError(404, 'not_found', 'No such team.')
    return team
  }

  // Launch --------------------------------------------------------------------------------------------------------
  // One launch per project. A team member reaches it through /projects/{id}/launch (the project's team check applies); a reviewer assigned from
  // outside the team, and an external reviewer, reach it through /launches/{id}, where access is decided by who they are to that launch (launches.ts).
  const launchErrors = (err: unknown): never => {
    if (err instanceof LaunchNotFound || err instanceof LinkNotFound) throw new ApiError(404, 'not_found', 'No such launch.')
    if (err instanceof NoThemes) throw new ApiError(409, 'no_themes', 'A launch can start once the project has themes.')
    if (err instanceof LaunchExists) throw new ApiError(409, 'launch_exists', 'This project already has a launch.')
    if (err instanceof NotTheReviewer) throw new ApiError(403, 'not_the_reviewer', err.who.length ? `Only ${err.who.join(' or ')} can answer this step.` : 'Nobody is set up to answer this step yet. An owner can add a reviewer under Admin, Members, Reviewers.')
    if (err instanceof StepNotUsed) throw new ApiError(409, 'step_not_used', 'This team’s launches do not use that step.')
    if (err instanceof BadAnswer) throw new ApiError(422, 'validation_failed', 'That is not an answer for this step.', 'answer')
    if (err instanceof NeedsRationale) throw new ApiError(422, 'validation_failed', 'Say why: this answer needs a reason.', 'rationale')
    if (err instanceof BadLink) throw new ApiError(422, 'validation_failed', 'Enter a link that starts with http:// or https://.', 'url')
    throw err
  }
  const launchId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such launch.')
    return id
  }
  const oneLaunch = async (c: Context, id: string) => {
    const launch = await getLaunch(getDb(), c.get('ctx'), id)
    if (!launch) throw new ApiError(404, 'not_found', 'No such launch.')
    return launch
  }

  app.get('/projects/:id/launch', withReadContext, async (c) => {
    const id = projectId(c)
    const ctx = c.get('ctx')
    if (!(await getProjectDetail(getDb(), ctx.workspaceId, id))) throw new ApiError(404, 'not_found', 'No such project.')
    c.header('Cache-Control', 'private, no-store')
    return c.json(await getProjectLaunch(getDb(), ctx, id))
  })
  app.post('/projects/:id/launch', withContext, async (c) => {
    const id = projectId(c)
    const input = parseBody(createLaunchSchema, await readJson(c))
    let made: string
    try {
      made = await createLaunch(getDb(), c.get('ctx'), id, input)
    } catch (err) {
      return launchErrors(err)
    }
    // The launch's thread opens in its team's Slack channel, if the team has one. A failed post never fails the launch.
    await startThread({ db: getDb(), env, slack }, c.get('ctx').workspaceId, made).catch((err) => console.error('launch slack failed', err instanceof Error ? err.message : err))
    c.header('Cache-Control', 'no-store')
    return c.json(await oneLaunch(c, made), 201)
  })
  app.get('/launches', withReadContext, async (c) => {
    c.header('Cache-Control', 'private, no-store')
    return c.json({ data: await listLaunches(getDb(), c.get('ctx')) })
  })
  app.get('/launches/:id', withReadContext, async (c) => {
    c.header('Cache-Control', 'private, no-store')
    return c.json(await oneLaunch(c, launchId(c)))
  })
  app.patch('/launches/:id', withContext, async (c) => {
    const id = launchId(c)
    const launch = await oneLaunch(c, id)
    if (!launch.you.canSetUp) throw new ApiError(403, 'forbidden', 'Only an editor of the project’s team can change the launch’s details.')
    const input = parseBody(setUpLaunchSchema, await readJson(c))
    try {
      await setUpLaunch(getDb(), c.get('ctx'), id, input)
    } catch (err) {
      return launchErrors(err)
    }
    // A change to the brief notes reopens answers: the reviewers are asked to confirm now, not at the next hourly sweep.
    if (input.briefNotes !== undefined) await sweepLaunch({ db: getDb(), env, mailer, slack }, c.get('ctx').workspaceId, id).catch((err) => console.error('launch notice failed', err instanceof Error ? err.message : err))
    c.header('Cache-Control', 'no-store')
    return c.json(await oneLaunch(c, id))
  })
  // Opens the launch's Slack thread (for a launch made before its team had a channel, or after a failed post). The result says why, if it could not.
  app.post('/launches/:id/slack', withContext, async (c) => {
    const id = launchId(c)
    const launch = await oneLaunch(c, id)
    if (!launch.you.canSetUp) throw new ApiError(403, 'forbidden', 'Only an editor of the project’s team can open its Slack thread.')
    const result = await startThread({ db: getDb(), env, slack }, c.get('ctx').workspaceId, id)
    c.header('Cache-Control', 'no-store')
    return c.json(result)
  })
  // The launch owner asks the reviewers of the steps still waiting (or reopened). Asking again for the same brief sends nothing more.
  app.post('/launches/:id/request', withContext, async (c) => {
    const id = launchId(c)
    const launch = await oneLaunch(c, id)
    if (!launch.you.canSetUp) throw new ApiError(403, 'forbidden', 'Only an editor of the project’s team can ask for answers.')
    const result = await requestAnswers({ db: getDb(), env, mailer, slack }, c.get('ctx').workspaceId, id)
    c.header('Cache-Control', 'no-store')
    return c.json(result)
  })
  app.put('/launches/:id/steps/:step', withContext, async (c) => {
    const id = launchId(c)
    const input = parseBody(launchAnswerSchema, await readJson(c))
    const step = c.req.param('step') ?? ''
    try {
      await answerStep(getDb(), c.get('ctx'), id, step, input)
    } catch (err) {
      return launchErrors(err)
    }
    // The owner is told (the whole launch, for the final decision). A failed email never fails the answer.
    await noticeAnswered({ db: getDb(), env, mailer, slack }, c.get('ctx').workspaceId, id, step, c.get('ctx').userId).catch((err) => console.error('launch notice failed', err instanceof Error ? err.message : err))
    c.header('Cache-Control', 'no-store')
    return c.json(await oneLaunch(c, id))
  })
  app.post('/launches/:id/steps/:step/links', withContext, async (c) => {
    const id = launchId(c)
    const input = parseBody(launchLinkSchema, await readJson(c))
    try {
      await addLink(getDb(), c.get('ctx'), id, c.req.param('step') ?? '', input)
    } catch (err) {
      return launchErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await oneLaunch(c, id), 201)
  })
  app.delete('/launches/:id/links/:linkId', withContext, async (c) => {
    const id = launchId(c)
    const link = c.req.param('linkId') ?? ''
    if (!UUID.test(link)) throw new ApiError(404, 'not_found', 'No such link.')
    try {
      await removeLink(getDb(), c.get('ctx'), id, link)
    } catch (err) {
      return launchErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await oneLaunch(c, id))
  })

  // Launch reviewers: standing assignments, and which steps each team uses. Owners only.
  const reviewerErrors = (err: unknown): never => {
    if (err instanceof MemberNotFound) throw new ApiError(404, 'not_found', 'No such member.')
    if (err instanceof TeamNotFound) throw new ApiError(404, 'not_found', 'No such team.')
    if (err instanceof ReviewerNotFound) throw new ApiError(404, 'not_found', 'No such assignment.')
    if (err instanceof BadStep) throw new ApiError(422, 'bad_step', 'That step cannot be set that way.')
    if (err instanceof ExternalAllTeams) throw new ApiError(422, 'external_all_teams', 'An external member can cover named teams only, not all teams.', 'teams')
    if (err instanceof PrimaryTaken) throw new ApiError(409, 'primary_taken', `${err.who} is already the primary for that step and team. Make one of them an alternate, or remove one first.`)
    throw err
  }
  app.get('/reviewers', withContext, async (c) => {
    requireLeader(c, 'launch reviewers')
    c.header('Cache-Control', 'private, no-store')
    return c.json(await reviewerOverview(getDb(), c.get('ctx').workspaceId))
  })
  app.post('/reviewers', withContext, async (c) => {
    requireLeader(c, 'launch reviewers')
    const input = parseBody(addReviewerSchema, await readJson(c))
    try {
      await addReviewer(getDb(), c.get('ctx'), input)
    } catch (err) {
      return reviewerErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await reviewerOverview(getDb(), c.get('ctx').workspaceId), 201)
  })
  app.delete('/reviewers/:id', withContext, async (c) => {
    requireLeader(c, 'launch reviewers')
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such assignment.')
    try {
      await removeReviewer(getDb(), c.get('ctx'), id)
    } catch (err) {
      return reviewerErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await reviewerOverview(getDb(), c.get('ctx').workspaceId))
  })
  app.put('/teams/:id/launch-steps', withContext, async (c) => {
    requireLeader(c, 'launch steps')
    const id = teamId(c)
    const input = parseBody(teamStepsSchema, await readJson(c))
    try {
      await setTeamSteps(getDb(), c.get('ctx'), id, input.used)
    } catch (err) {
      return reviewerErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await reviewerOverview(getDb(), c.get('ctx').workspaceId))
  })

  app.put('/teams/:id/slack-channel', withContext, async (c) => {
    requireLeader(c, 'a team’s Slack channel')
    const id = teamId(c)
    const input = parseBody(teamSlackSchema, await readJson(c))
    const channel = input.channel === null || input.channel.trim() === '' ? null : cleanChannel(input.channel)
    if (input.channel !== null && input.channel.trim() !== '' && !channel) throw new ApiError(422, 'invalid', 'A Slack channel name is lower case letters, numbers, hyphens and underscores, such as launches.')
    try {
      await setTeamSlackChannel(getDb(), c.get('ctx'), id, channel)
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ data: await listTeams(getDb(), c.get('ctx').workspaceId) })
  })

  app.get('/teams', withContext, async (c) => {
    requireLeader(c)
    c.header('Cache-Control', 'private, no-store')
    return c.json({ data: await listTeams(getDb(), c.get('ctx').workspaceId) })
  })

  app.post('/teams', withContext, async (c) => {
    requireLeader(c)
    const input = parseBody(teamNameSchema, await readJson(c))
    let id: string
    try {
      id = await createTeam(getDb(), c.get('ctx'), input.name)
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await oneTeam(c, id), 201)
  })

  app.patch('/teams/:id', withContext, async (c) => {
    requireLeader(c)
    const id = teamId(c)
    const input = parseBody(teamNameSchema, await readJson(c))
    try {
      await renameTeam(getDb(), c.get('ctx'), id, input.name)
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await oneTeam(c, id))
  })

  app.delete('/teams/:id', withContext, async (c) => {
    requireLeader(c)
    try {
      await deleteTeam(getDb(), c.get('ctx'), teamId(c))
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })

  // With team groups on, people's places in every team but the default one come from their sign-in groups, so a change here would be undone at their next sign-in.
  const requireTeamMembersEditable = async (id: string) => {
    if (!ssoPolicy(env).teamGroupPrefix) return
    const t = (await getDb().query(`select is_default from core.teams where id = $1`, [id])).rows[0]
    if (t && !t.is_default) throw new ApiError(409, 'managed_by_sso', 'People’s places in this team come from your sign-in groups. Change them in your identity provider.')
  }

  app.put('/teams/:id/members/:memberId', withContext, async (c) => {
    requireLeader(c)
    const id = teamId(c)
    await requireTeamMembersEditable(id)
    const member = c.req.param('memberId') ?? ''
    if (!UUID.test(member)) throw new ApiError(404, 'not_found', 'No such member.')
    const input = parseBody(teamMemberRoleSchema, await readJson(c))
    try {
      await setTeamMember(getDb(), c.get('ctx'), id, member, input.role)
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await oneTeam(c, id))
  })

  app.delete('/teams/:id/members/:memberId', withContext, async (c) => {
    requireLeader(c)
    await requireTeamMembersEditable(teamId(c))
    const member = c.req.param('memberId') ?? ''
    if (!UUID.test(member)) throw new ApiError(404, 'not_found', 'No such member.')
    try {
      await removeTeamMember(getDb(), c.get('ctx'), teamId(c), member)
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })

  app.put('/teams/:id/projects/:projectId', withContext, async (c) => {
    requireLeader(c)
    const id = teamId(c)
    const project = c.req.param('projectId') ?? ''
    if (!UUID.test(project)) throw new ApiError(404, 'not_found', 'No such project.')
    try {
      await moveProject(getDb(), c.get('ctx'), id, project)
    } catch (err) {
      return teamErrors(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await oneTeam(c, id))
  })

  // System usage: owners only. How much of each limit the app has used (today the database's size).
  app.get('/usage', withContext, async (c) => {
    requireOwner(c)
    c.header('Cache-Control', 'private, no-store')
    return c.json({ data: await getUsage(getDb(), env) })
  })

  // The admin audit log: owners only, newest first, a page at a time, optionally one kind of change.
  app.get('/audit', withContext, async (c) => {
    requireOwner(c)
    const group = c.req.query('group')
    if (group && !(group in AUDIT_GROUPS)) throw new ApiError(422, 'validation_failed', 'Unknown group.', 'group')
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50))
    const team = c.req.query('teamId')
    if (team && !UUID.test(team)) throw new ApiError(422, 'validation_failed', 'Not a team id.', 'teamId')
    c.header('Cache-Control', 'private, no-store')
    return c.json(await listAudit(getDb(), c.get('ctx').workspaceId, { group: group as AuditGroup | undefined, teamId: team, limit, cursor: c.req.query('cursor') }).catch((err) => {
      if (err instanceof BadCursor) throw new ApiError(422, 'validation_failed', 'That page marker is not valid.', 'cursor')
      throw err
    }))
  })

  app.get('/projects', withReadContext, async (c) => {
    const data = await listProjects(getDb(), c.get('ctx').workspaceId, c.get('ctx'))
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
      id = await createProject(getDb(), { ...ctx, teamId: await newProjectTeam(getDb(), ctx, input.teamId) }, input)
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
      if (err instanceof AreaMissing) throw new ApiError(422, 'unknown_area', 'That experience category does not exist or has been retired. Choose another.', 'areaId')
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
        // The matcher keeps Platform Insights in step with the new themes; the analysis stands if it fails. New platform themes are where duplicates
        // start, so the clear ones are folded together right after (each recorded, so it can be undone from the Platform Themes page).
        const matched = await refreshPlatformMatches(getDb(), ai, c.get('ctx').workspaceId).catch(() => undefined)
        if (matched && 'created' in matched && matched.created) await autoMergeDuplicates(getDb(), ai, c.get('ctx')).catch(() => undefined)
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
  // Files a theme under an experience category, or none. The analysis chooses one; this is the person's correction.
  app.put('/themes/:id/area', withContext, async (c) => {
    requireEditor(c)
    const themeId = c.req.param('id')
    if (!UUID.test(themeId)) throw new ApiError(404, 'not_found', 'No such theme.')
    const input = parseBody(themeAreaSchema, await readJson(c))
    try {
      await setThemeArea(getDb(), c.get('ctx'), themeId, input.areaId)
    } catch (err) {
      if (err instanceof ThemeNotFound) throw new ApiError(404, 'not_found', 'No such theme.')
      if (err instanceof AreaMissing) throw new ApiError(422, 'unknown_area', 'That experience category does not exist or has been retired. Choose another.', 'areaId')
      throw err
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await getTheme(getDb(), c.get('ctx').workspaceId, themeId))
  })

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
    if (err instanceof NotPublished) throw new ApiError(409, 'not_published', 'Publish the document first: the board is made from it.')
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
    const data = await listSpecs(getDb(), c.get('ctx').workspaceId, { projectId, standalone: c.req.query('standalone') === 'true' }, c.get('ctx'))
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data })
  })

  app.post('/projects/:id/specs', withContext, async (c) => {
    requireEditor(c)
    const id = projectId(c)
    const input = parseBody(createSpecSchema, await readJson(c))
    let made: { id: string; created: boolean }
    try {
      made = await createProjectSpec(getDb(), ai, c.get('ctx'), id, input.name)
    } catch (err) {
      return specError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(await specDetail(c, made.id), made.created ? 201 : 200)
  })

  app.post('/specs/standalone', withContext, async (c) => {
    requireEditor(c)
    const input = parseBody(standaloneSpecSchema, await readJson(c))
    const ctx = c.get('ctx')
    const created = await createStandaloneSpec(getDb(), ai, ctx, input, await newProjectTeam(getDb(), ctx))
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
  app.post('/agent-steps/:id/approve', withContext, (c) => stepAction(c, null, (stepId, v) => approveStep(getDb(), ai, c.get('ctx'), stepId, v, c.req.query('draftNext') !== 'false')))
  app.post('/agent-steps/:id/draft', withContext, (c) => stepAction(c, null, (stepId, v) => draftWaitingStep(getDb(), ai, c.get('ctx'), stepId, v)))
  app.post('/agent-steps/:id/redo', withContext, (c) => stepAction(c, redoSchema, (stepId, v, input) => redoStep(getDb(), ai, c.get('ctx'), stepId, v, input.instructions)))
  app.patch('/agent-steps/:id', withContext, (c) => stepAction(c, editStepSchema, (stepId, v, input) => editStep(getDb(), c.get('ctx'), stepId, v, input.text)))

  // What "Update board" would change (preview) or does (apply). Never removes a story that has been worked on.
  app.post('/specs/:id/board-sync', withContext, async (c) => {
    requireEditor(c)
    const id = specId(c)
    const input = parseBody(boardSyncSchema, await readJson(c))
    let result
    try {
      result = await syncBoard(getDb(), c.get('ctx'), id, input.apply === true)
    } catch (err) {
      return specError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(result)
  })

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


  // The Jira hand-off (simulated): the tickets made from a project's stories, and making one.
  app.get('/projects/:id/tickets', withReadContext, async (c) => {
    const id = projectId(c)
    const ctx = c.get('ctx')
    if (!(await getProjectDetail(getDb(), ctx.workspaceId, id))) throw new ApiError(404, 'not_found', 'No such project.')
    c.header('Cache-Control', 'private, no-store')
    return c.json({ data: await listTickets(getDb(), ctx.workspaceId, id) })
  })

  // Experience categories ---------------------------------------------------------------------------------------------
  // The shared list of what research is about. Anyone reads it; an editor adds a category (after a duplicate check) and edits one; only an
  // owner merges and retires, which change a lot of existing work at once. An area is a label on a question, task or test item, never a requirement.

  const requireAreaOwner = (c: Context) => {
    if (c.get('ctx').role !== 'owner') throw new ApiError(403, 'forbidden', 'Only an owner can merge or retire an experience category.')
  }
  const areaId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such experience category.')
    return id
  }
  const areaErrors = (err: unknown): never => {
    if (err instanceof AreaMissing) throw new ApiError(404, 'not_found', 'No such experience category.')
    if (err instanceof AreaDuplicate) throw new ApiError(409, 'duplicate_area', `"${err.existing.name}" already exists: use it.`, 'name', { existing: err.existing })
    if (err instanceof AreaSimilar) throw new ApiError(409, 'similar_area', `This looks like ${err.similar.map((s) => `"${s.name}"`).join(' or ')}. Use that, or add it anyway.`, 'name', { similar: err.similar })
    if (err instanceof AreaConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this category since you opened it.', undefined, { current: { version: err.current } })
    throw err
  }

  app.get('/areas', withReadContext, async (c) => {
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data: await listAreas(getDb(), c.get('ctx').workspaceId) })
  })
  // Suggested new areas: groups of themes with no area, by the word they share. Reading is open; accepting or dismissing is for editors.
  app.get('/areas/proposals', withReadContext, async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ data: await proposeAreas(getDb(), c.get('ctx').workspaceId) })
  })
  app.post('/areas/proposals/accept', withContext, async (c) => {
    requireEditor(c)
    const input = parseBody(acceptProposalSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    const done = await acceptProposal(getDb(), c.get('ctx'), input.key, input.name ?? undefined).catch((err) => {
      if (err instanceof ProposalMissing) throw new ApiError(404, 'not_found', 'That suggestion is no longer there. Reload the page.')
      return areaErrors(err)
    })
    return c.json(done, 201)
  })
  app.post('/areas/proposals/dismiss', withContext, async (c) => {
    requireEditor(c)
    const input = parseBody(dismissProposalSchema, await readJson(c))
    await dismissProposal(getDb(), c.get('ctx'), input.key)
    return c.body(null, 204)
  })
  app.post('/areas', withContext, async (c) => {
    requireEditor(c)
    const input = parseBody(createAreaSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await createArea(getDb(), c.get('ctx'), input).catch(areaErrors), 201)
  })
  app.patch('/areas/:id', withContext, async (c) => {
    requireEditor(c)
    const id = areaId(c)
    const expected = expectedVersion(c)
    const input = parseBody(updateAreaSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await updateArea(getDb(), c.get('ctx'), id, expected, input).catch(areaErrors))
  })
  app.post('/areas/:id/merge', withContext, async (c) => {
    requireAreaOwner(c)
    const id = areaId(c)
    const input = parseBody(mergeAreaSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await mergeAreas(getDb(), c.get('ctx'), id, input.intoId).catch(areaErrors))
  })
  app.post('/areas/:id/retire', withContext, async (c) => {
    requireAreaOwner(c)
    const id = areaId(c)
    c.header('Cache-Control', 'no-store')
    return c.json(await retireArea(getDb(), c.get('ctx'), id).catch(areaErrors))
  })

  // Workflows (the service blueprint): anyone reads; editors and owners change them. A workflow is saved whole, against its version.
  const workflowId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such workflow.')
    return id
  }
  const workflowErrors = (err: unknown): never => {
    if (err instanceof WorkflowMissing) throw new ApiError(404, 'not_found', 'No such workflow.')
    if (err instanceof ProjectNotFound) throw new ApiError(404, 'not_found', 'No such project.')
    if (err instanceof WorkflowDuplicate) throw new ApiError(409, 'duplicate_workflow', `A workflow named "${err.name}" already exists.`, 'name')
    if (err instanceof WorkflowConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this workflow since you opened it.', undefined, { current: { version: err.current } })
    if (err instanceof StageMissing) throw new ApiError(422, 'validation_failed', 'That stage does not belong here.', 'workflowStageId')
    throw err
  }
  app.get('/workflows', withReadContext, async (c) => {
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    const ws = c.get('ctx').workspaceId
    return c.json({ data: await listWorkflows(getDb(), ws, undefined, visibleTeamIds(c.get('ctx'))), sampleMissing: await sampleMissing(getDb(), ws) })
  })
  app.post('/workflows/sample', withContext, async (c) => {
    requireEditor(c)
    c.header('Cache-Control', 'no-store')
    const data = await addSampleWorkflows(getDb(), c.get('ctx'))
    return c.json({ data, sampleMissing: await sampleMissing(getDb(), c.get('ctx').workspaceId) }, 201)
  })
  app.post('/workflows', withContext, async (c) => {
    requireEditor(c)
    const input = parseBody(workflowSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await createWorkflow(getDb(), c.get('ctx'), input).catch(workflowErrors), 201)
  })
  app.put('/workflows/:id', withContext, async (c) => {
    requireEditor(c)
    const id = workflowId(c)
    const expected = expectedVersion(c)
    const input = parseBody(workflowSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await saveWorkflow(getDb(), c.get('ctx'), id, expected, input).catch(workflowErrors))
  })
  app.delete('/workflows/:id', withContext, async (c) => {
    requireEditor(c)
    const id = workflowId(c)
    await deleteWorkflow(getDb(), c.get('ctx'), id).catch(workflowErrors)
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })
  // A project's workflow and how its journey stages map onto the workflow's stages.
  app.get('/projects/:id/blueprint', withReadContext, async (c) => {
    const id = projectId(c)
    c.header('Cache-Control', 'private, no-store')
    return c.json(await projectBlueprint(getDb(), c.get('ctx').workspaceId, id).catch(workflowErrors))
  })
  app.put('/projects/:id/workflow', withContext, async (c) => {
    requireEditor(c)
    const id = projectId(c)
    const input = parseBody(projectWorkflowSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await setProjectWorkflow(getDb(), c.get('ctx'), id, input.workflowId).catch(workflowErrors))
  })
  app.put('/projects/:id/stage-map', withContext, async (c) => {
    requireEditor(c)
    const id = projectId(c)
    const input = parseBody(mapStageSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await mapProjectStage(getDb(), c.get('ctx'), id, input.position, input.workflowStageId).catch(workflowErrors))
  })

  // The Design step ------------------------------------------------------------------------------------------

  app.get('/projects/:id/design', withReadContext, async (c) => {
    const id = projectId(c)
    const ctx = c.get('ctx')
    if (!(await getProjectDetail(getDb(), ctx.workspaceId, id))) throw new ApiError(404, 'not_found', 'No such project.')
    let design
    try {
      design = await getDesign(getDb(), ctx.workspaceId, id)
    } catch (err) {
      if (err instanceof NoBoard) throw new ApiError(404, 'no_board', 'Publish a requirements document first: the design table is made from it.')
      throw err
    }
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ ...design, captureEnabled: captureOn() })
  })

  app.put('/stories/:id/design', withContext, async (c) => {
    requireEditor(c)
    const id = storyId(c)
    const expected = expectedVersion(c)
    const input = parseBody(designSchema, await readJson(c))
    const image = input.image === undefined ? undefined : input.image === null ? null : { type: input.image.type, data: Buffer.from(input.image.data, 'base64') }
    if (image && image.data.length > 600_000) throw new ApiError(422, 'validation_failed', 'The picture is too large.', 'image')
    try {
      await saveDesignItem(getDb(), c.get('ctx'), id, expected, { prototypeUrl: input.prototypeUrl, notes: input.notes, image })
    } catch (err) {
      if (err instanceof DesignConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this row since you opened it.', undefined, { current: { version: err.current } })
      return storyError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json((await getDesignItem(getDb(), c.get('ctx').workspaceId, id))!)
  })

  // Takes a thumbnail from the saved prototype link, on our side. The model-free work runs before any database transaction: the page
  // is loaded first, then the picture is kept only if the row still has that link.
  app.post('/stories/:id/design/capture', withContext, async (c) => {
    requireEditor(c)
    const id = storyId(c)
    const ctx = c.get('ctx')
    const { replace } = parseBody(captureSchema, await readJson(c).catch(() => ({})))
    const item = await getDesignItem(getDb(), ctx.workspaceId, id)
    if (!item) throw new ApiError(404, 'not_found', 'No such requirement.')
    if (!item.prototypeUrl) throw new ApiError(422, 'no_link', 'Link the prototype first: the thumbnail is taken from the link.', 'prototypeUrl')
    if (!capture || !captureOn()) throw new ApiError(503, 'capture_unavailable', 'Thumbnails from links are switched off on this deployment. Upload a screenshot instead.')
    if (item.hasImage && !replace && item.imageSource === 'upload') {
      c.header('Cache-Control', 'no-store')
      return c.json(item)
    }
    let shot
    try {
      shot = await capture(item.prototypeUrl)
    } catch (err) {
      if (err instanceof CaptureError) throw new ApiError(422, 'capture_failed', err.message)
      console.error(err)
      throw new ApiError(422, 'capture_failed', 'The page could not be captured. Upload a screenshot instead.')
    }
    try {
      await saveCapturedImage(getDb(), ctx, id, item.prototypeUrl, shot, !!replace)
    } catch (err) {
      if (err instanceof DesignChanged) throw new ApiError(409, 'link_changed', 'The link changed while the page was loading, so the picture was not kept.')
      throw err
    }
    c.header('Cache-Control', 'no-store')
    return c.json((await getDesignItem(getDb(), ctx.workspaceId, id))!)
  })

  // The thumbnail itself. The page asks for it with the row's version in the address, so a new picture is a new address.
  app.get('/stories/:id/design/image', withReadContext, async (c) => {
    const img = await getDesignImage(getDb(), c.get('ctx').workspaceId, storyId(c))
    if (!img) throw new ApiError(404, 'not_found', 'There is no picture.')
    return new Response(new Uint8Array(img.data), { headers: { 'content-type': img.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } })
  })

  // Measure -----------------------------------------------------------------------------------------------------

  // Measure is a place of its own: every requirement of every project the caller can see (the same team rules as Platform Insights), which the
  // screen narrows by project, team and result.
  app.get('/measure', withReadContext, async (c) => {
    const ctx = c.get('ctx')
    const body = await getMeasureAcross(getDb(), ctx.workspaceId, visibleTeamIds(ctx), ctx.anonymous ? [] : editableTeamIds(ctx))
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(body)
  })

  app.get('/projects/:id/measure', withReadContext, async (c) => {
    const id = projectId(c)
    const ctx = c.get('ctx')
    if (!(await getProjectDetail(getDb(), ctx.workspaceId, id))) throw new ApiError(404, 'not_found', 'No such project.')
    let measure
    try {
      measure = await getMeasure(getDb(), ctx.workspaceId, id)
    } catch (err) {
      if (err instanceof NoBoard) throw new ApiError(404, 'no_board', 'Publish a requirements document first: the measures are made from it.')
      throw err
    }
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(measure)
  })

  app.put('/stories/:id/measure', withContext, async (c) => {
    requireEditor(c)
    const id = storyId(c)
    const expected = expectedVersion(c)
    const input = parseBody(measureSchema, await readJson(c))
    try {
      await saveMeasureItem(getDb(), c.get('ctx'), id, expected, input)
    } catch (err) {
      if (err instanceof MeasureConflict) throw new ApiError(409, 'version_conflict', 'Someone else changed this row since you opened it.', undefined, { current: { version: err.current } })
      return storyError(err)
    }
    c.header('Cache-Control', 'no-store')
    return c.json((await getMeasureItem(getDb(), c.get('ctx').workspaceId, id))!)
  })

  // Platform Insights ------------------------------------------------------------------------------------

  app.get('/insights/themes', withReadContext, async (c) => {
    const body = await getThemesOverview(getDb(), c.get('ctx').workspaceId, visibleTeamIds(c.get('ctx')))
    cacheHeaders(c)
    return c.json(body)
  })
  app.get('/insights/themes/:id', withReadContext, async (c) => {
    const id = c.req.param('id') ?? ''
    const theme = UUID.test(id) ? await getPlatformTheme(getDb(), c.get('ctx').workspaceId, id, visibleTeamIds(c.get('ctx'))) : undefined
    if (!theme) throw new ApiError(404, 'not_found', 'No such platform theme.')
    cacheHeaders(c)
    return c.json(theme)
  })
  app.post('/insights/themes/:id/reviewed', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id) || !(await markThemeReviewed(getDb(), c.get('ctx').workspaceId, id))) throw new ApiError(404, 'not_found', 'No such platform theme.')
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })
  const themeId = (c: Context) => {
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such platform theme.')
    return id
  }
  const themeErrors = (err: unknown): never => {
    if (err instanceof PlatformThemeMissing) throw new ApiError(404, 'not_found', 'No such platform theme.')
    if (err instanceof DuplicateTitle) throw new ApiError(409, 'duplicate_title', `${err.message} Merge the two themes instead.`, 'title')
    if (err instanceof SameTheme) throw new ApiError(422, 'validation_failed', 'Choose a different theme to merge into.', 'intoId')
    if (err instanceof NotFiledByHand) throw new ApiError(409, 'not_filed_by_hand', 'This theme’s category was not filed by hand, so there is nothing to take back here.')
    if (err instanceof AlreadyAssigned) throw new ApiError(409, 'already_assigned', 'This theme already has an experience category.')
    if (err instanceof AreaMissing) throw new ApiError(422, 'unknown_area', 'That experience category does not exist or has been retired. Choose another.', 'areaId')
    throw err
  }
  // Takes back a person's filing of a theme under an area.
  app.delete('/insights/themes/:id/area', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    const id = themeId(c)
    c.header('Cache-Control', 'no-store')
    return c.json(await clearThemeArea(getDb(), c.get('ctx'), id).catch(themeErrors))
  })
  // Fills in the area of a theme that has none (the Group by Experience category table). A theme that has one is not changed here.
  app.put('/insights/themes/:id/area', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    const id = themeId(c)
    const input = parseBody(z.object({ areaId: z.uuid('Choose an experience category.') }), await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await assignThemeArea(getDb(), c.get('ctx'), id, input.areaId).catch(themeErrors))
  })
  app.patch('/insights/themes/:id', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    const input = parseBody(z.object({ title: z.string().trim().min(3, 'Give the theme a title of at least 3 characters.').max(90, 'Keep the title to 90 characters.') }), await readJson(c))
    c.header('Cache-Control', 'no-store')
    return c.json(await renameTheme(getDb(), c.get('ctx'), themeId(c), input.title).catch(themeErrors))
  })
  app.post('/insights/themes/:id/merge', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    const id = themeId(c)
    const input = parseBody(z.object({ intoId: z.string().regex(UUID, 'Choose the theme to merge into.') }), await readJson(c))
    c.header('Cache-Control', 'no-store')
    const merged = await mergeThemes(getDb(), c.get('ctx'), id, input.intoId).catch(themeErrors)
    return c.json({ id: merged.id, title: merged.title })
  })
  // What was merged, newest first, and taking one back. Automatic merges are listed with the person's own so one list answers "what changed?".
  app.get('/insights/merges', withReadContext, async (c) => {
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json({ data: await listMerges(getDb(), c.get('ctx').workspaceId) })
  })
  app.post('/insights/merges/:id/undo', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    const id = c.req.param('id') ?? ''
    if (!UUID.test(id)) throw new ApiError(404, 'not_found', 'No such merge.')
    c.header('Cache-Control', 'no-store')
    try {
      return c.json(await undoMerge(getDb(), c.get('ctx'), id))
    } catch (err) {
      if (err instanceof MergeHistoryMissing) throw new ApiError(404, 'not_found', 'That merge cannot be undone: it was already undone, or the theme it was folded into is gone.')
      if (err instanceof DuplicateTitle) throw new ApiError(409, 'duplicate_title', `"${err.existing}" is now used by another theme, so this one cannot be brought back under that name.`)
      throw err
    }
  })
  app.post('/insights/merge-suggestions/run', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    c.header('Cache-Control', 'no-store')
    return c.json(await findMergeSuggestions(getDb(), ai, c.get('ctx').workspaceId))
  })
  app.post('/insights/merge-suggestions/:id/accept', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    c.header('Cache-Control', 'no-store')
    return c.json(await acceptSuggestion(getDb(), c.get('ctx'), themeId(c)).catch(themeErrors))
  })
  app.post('/insights/merge-suggestions/:id/dismiss', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    if (!(await dismissSuggestion(getDb(), c.get('ctx').workspaceId, themeId(c)))) throw new ApiError(404, 'not_found', 'No such suggestion.')
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })
  app.post('/insights/roadmap/rationale', withContext, async (c) => {
    requireEditor(c)
    requireLeader(c, 'the platform themes')
    c.header('Cache-Control', 'no-store')
    return c.json(await writeRankRationales(getDb(), ai, c.get('ctx').workspaceId))
  })
  app.get('/projects/:id/storyboard', withReadContext, async (c) => {
    const board = await getStoryboard(getDb(), c.get('ctx').workspaceId, projectId(c))
    if (!board) throw new ApiError(404, 'not_found', 'No such project.')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(board)
  })
  app.post('/projects/:id/storyboard/generate', withContext, async (c) => {
    requireEditor(c)
    c.header('Cache-Control', 'no-store')
    try {
      return c.json(await generateStoryboard(getDb(), ai, c.get('ctx'), projectId(c)))
    } catch (err) {
      if (err instanceof NoStoryboardProject) throw new ApiError(404, 'not_found', 'No such project.')
      if (err instanceof NoThemesYet) throw new ApiError(409, 'no_themes', 'This project has no themes yet. Add transcripts and run the analysis first.')
      throw err
    }
  })
  app.get('/projects/:id/case-study-brief', withReadContext, async (c) => {
    const id = projectId(c)
    const brief = await getCaseBrief(getDb(), c.get('ctx').workspaceId, id)
    if (!brief) throw new ApiError(404, 'not_found', 'No such project.')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(brief)
  })
  app.get('/insights/case-briefs', withReadContext, async (c) => {
    const data = await listCaseBriefs(getDb(), c.get('ctx').workspaceId, visibleTeamIds(c.get('ctx')))
    cacheHeaders(c)
    return c.json({ data })
  })
  app.get('/insights/customers', withReadContext, async (c) => {
    const body = await getCustomers(getDb(), c.get('ctx').workspaceId, visibleTeamIds(c.get('ctx')))
    cacheHeaders(c)
    return c.json(body)
  })
  app.get('/insights/journey', withReadContext, async (c) => {
    const workflow = c.req.query('workflow')
    if (workflow && !UUID.test(workflow)) throw new ApiError(404, 'not_found', 'No such workflow.')
    const visible = visibleTeamIds(c.get('ctx'))
    const body = workflow ? await getWorkflowJourney(getDb(), c.get('ctx').workspaceId, workflow, visible) : await getPlatformJourney(getDb(), c.get('ctx').workspaceId, visible)
    if (!body) throw new ApiError(404, 'not_found', 'No such workflow.')
    cacheHeaders(c)
    c.header('Vary', 'Authorization')
    return c.json(body)
  })
  app.get('/insights/case-studies', withReadContext, async (c) => {
    const data = await listCaseStudies(getDb(), c.get('ctx').workspaceId, visibleTeamIds(c.get('ctx')))
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

  // What the Create ticket dialog offers: the connected Jira project's issue types, priorities and people (nothing to offer while it is simulated).
  app.get('/integrations/jira', withContext, async (c) => {
    requireEditor(c)
    c.header('Cache-Control', 'no-store')
    return c.json(jira ? await jira.status() : NOT_CONNECTED)
  })

  // Makes the Jira ticket for one requirement (a real issue when Jira is connected, else simulated). Once: a story that has a ticket cannot be sent again.
  app.post('/stories/:id/tickets', withContext, async (c) => {
    requireEditor(c)
    const id = storyId(c)
    const input = parseBody(createTicketSchema, await readJson(c))
    c.header('Cache-Control', 'no-store')
    try {
      return c.json(await createTicket(getDb(), c.get('ctx'), id, input, jira), 201)
    } catch (err) {
      if (err instanceof NoStory) throw new ApiError(404, 'not_found', 'No such story.')
      if (err instanceof NotTicketable) throw new ApiError(422, 'not_a_requirement', 'An open question is a decision to make, not a ticket. Decide it first.')
      if (err instanceof AlreadySent) throw new ApiError(409, 'already_sent', `This story was already sent as ${err.jiraKey}.`)
      if (err instanceof RecordFailed) throw new ApiError(502, 'ticket_not_recorded', err.message)
      throw err
    }
  })

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

  // Notifications. A person's own settings for the daily reminder email (owners and editors receive it; viewers have nothing to be reminded of).
  const canBeReminded = (c: Context) => ['owner', 'editor'].includes(c.get('ctx').role)
  app.get('/notifications/preferences', withContext, async (c) => {
    const ctx = c.get('ctx')
    const row = (
      await getDb().query(
        `select u.time_zone, coalesce(np.enabled, true) as enabled from core.users u
           left join core.notification_preferences np on np.user_id = u.id and np.kind = $2 and np.channel = 'email' where u.id = $1`,
        [ctx.userId, DIGEST],
      )
    ).rows[0]
    c.header('Cache-Control', 'private, no-store')
    return c.json({ email: ctx.email, receives: canBeReminded(c), digestEnabled: !!row?.enabled, timeZone: row?.time_zone ?? null, mailConfigured: mailer.live })
  })

  app.put('/notifications/preferences', withContext, async (c) => {
    const ctx = c.get('ctx')
    const input = parseBody(notificationPrefsSchema, await readJson(c))
    if (input.timeZone !== undefined && !validTimeZone(input.timeZone)) throw new ApiError(422, 'validation_failed', 'That is not a time zone.', 'timeZone')
    if (input.timeZone !== undefined) await getDb().query(`update core.users set time_zone = $2 where id = $1`, [ctx.userId, input.timeZone])
    if (input.digestEnabled !== undefined) {
      await getDb().query(
        `insert into core.notification_preferences (user_id, kind, enabled) values ($1, $2, $3)
         on conflict (user_id, kind, channel) do update set enabled = excluded.enabled, updated_at = now()`,
        [ctx.userId, DIGEST, input.digestEnabled],
      )
    }
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })

  // "Send me a reminder now": the reminder to this person immediately, for testing and demos.
  app.post('/notifications/digest/test', withContext, async (c) => {
    if (!canBeReminded(c)) throw new ApiError(403, 'forbidden', 'Only an owner or editor receives reminders.')
    c.header('Cache-Control', 'no-store')
    if (!mailer.live) return c.json({ outcome: 'not_configured' })
    const r = await runDigest({ db: getDb(), env, mailer }, { userId: c.get('ctx').userId })
    return c.json({ outcome: r.outcome ?? 'nothing_left', ...(r.error ? { error: r.error } : {}) })
  })

  // The one-click link in every reminder. Public (it is opened from an email, signed in or not) and it can only switch the reminder off.
  app.get('/notifications/unsubscribe', async (c) => {
    const u = c.req.query('u') ?? ''
    const ok = UUID.test(u) && unsubscribeValid(env, u, c.req.query('t') ?? '')
    if (ok) {
      await getDb().query(
        `insert into core.notification_preferences (user_id, kind, enabled) values ($1, $2, false)
         on conflict (user_id, kind, channel) do update set enabled = false, updated_at = now()`,
        [u, DIGEST],
      )
    }
    c.header('Cache-Control', 'no-store')
    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reminders</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${ok ? 'You are unsubscribed' : 'That link did not work'}</h1><p>${ok ? 'You will not get the daily reminder any more. You can turn it back on under Settings, Notifications.' : 'Open Settings, Notifications in the app to change your reminders.'}</p></body>`, ok ? 200 : 400)
  })

  // The hourly job (vercel.json "crons"). Vercel sends CRON_SECRET as a Bearer token. Without that variable the route is closed.
  app.get('/cron/digest', async (c) => {
    const secret = env.CRON_SECRET
    if (!secret) throw new ApiError(503, 'cron_not_configured', 'CRON_SECRET is not set.')
    const got = Buffer.from(c.req.header('authorization') ?? '')
    const want = Buffer.from(`Bearer ${secret}`)
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new ApiError(401, 'unauthorized', 'Missing or invalid token.')
    c.header('Cache-Control', 'no-store')
    const digest = await runDigest({ db: getDb(), env, mailer })
    // The same hourly run also sends the launch messages that are due: reopened answers, requests that have waited, a step nobody covers.
    const launches = await sweepLaunches({ db: getDb(), env, mailer, slack })
    return c.json({ ...digest, launches })
  })

  return app
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
