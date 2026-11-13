// Typed client for the API. Types come from openapi/openapi.yaml (npm run gen:api); every function here
// is one operation in that spec, and the MCP data-binding check will match hooks to these names.
import type { components } from './schema'
import { getToken } from './token'

export type Project = components['schemas']['ProjectSummary']
export type ProjectTint = Project['color']
export type Me = components['schemas']['Me']

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    /** On a 409, the version the project is at now. */
    public current?: { version: number },
    /** Other fields of the error body: `existing` and `similar` on a duplicate area. */
    public extra: Record<string, any> = {},
  ) {
    super(message)
  }
}

type SendOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; token?: string | null; version?: number }

// Every request carries the editing token when the tab has one. 204 responses have no body.
async function request<T>(path: string, { method = 'GET', body, token, version }: SendOptions = {}): Promise<T> {
  const bearer = token === undefined ? getToken() : token
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(version !== undefined ? { 'if-match': String(version) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const parsed = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, parsed?.error?.code ?? 'unknown', parsed?.error?.message ?? res.statusText, parsed?.error?.field, parsed?.current, parsed ?? {})
  return parsed as T
}

export type Health = { status: 'ok'; time: string; version: string }
export type DatabaseHealth = { status: 'ok'; database: 'reachable'; migrations: number }

export const getHealth = () => request<Health>('/health')
export const getDatabaseHealth = () => request<DatabaseHealth>('/health/db')
export type AiStatus = components['schemas']['AiStatus']
export type Design = components['schemas']['Design']
export type DesignItem = components['schemas']['DesignItem']
export type DesignRequest = components['schemas']['DesignRequest']
export const getDesign = (projectId: string) => request<Design>(`/projects/${projectId}/design`)
// The row's version is 0 when nothing has been saved for the requirement yet.
export const saveDesignItem = (storyId: string, version: number, body: DesignRequest) => request<DesignItem>(`/stories/${storyId}/design`, { method: 'PUT', body, version })
// Takes the thumbnail from the saved prototype link, on the server. `replace` lets it overwrite a picture a person uploaded.
export const captureDesignImage = (storyId: string, replace = false) => request<DesignItem>(`/stories/${storyId}/design/capture`, { method: 'POST', body: replace ? { replace: true } : {} })
export const designImageUrl = (storyId: string, version: number) => `/api/v1/stories/${storyId}/design/image?v=${version}`

export type Measure = components['schemas']['Measure']
export type MeasureItem = components['schemas']['MeasureItem']
export type MeasureAcross = components['schemas']['MeasureAcross']
export type MeasureAcrossItem = components['schemas']['MeasureAcrossItem']
export type MeasureRequest = components['schemas']['MeasureRequest']
export type Checkin = components['schemas']['Checkin']
export const getMeasure = (projectId: string) => request<Measure>(`/projects/${projectId}/measure`)
export const getMeasureAcross = () => request<MeasureAcross>('/measure')
// The row's version is 0 when nothing has been saved for the requirement yet.
export const saveMeasureItem = (storyId: string, version: number, body: MeasureRequest) => request<MeasureItem>(`/stories/${storyId}/measure`, { method: 'PUT', body, version })

export type NotificationPreferences = components['schemas']['NotificationPreferences']
export const getNotificationPreferences = () => request<NotificationPreferences>('/notifications/preferences')
export const saveNotificationPreferences = (body: { digestEnabled?: boolean; timeZone?: string }) => request<null>('/notifications/preferences', { method: 'PUT', body })
export const sendReminderNow = () => request<{ outcome: 'sent' | 'nothing_left' | 'not_configured' | 'failed'; error?: string }>('/notifications/digest/test', { method: 'POST' })
export const getAiStatus = () => request<AiStatus>('/ai/status')
export const getMe = (token?: string | null) => request<Me>('/me', { token })
export type SignInOption = components['schemas']['SignInOptionList']['data'][number]
export const getSignInOptions = () => request<components['schemas']['SignInOptionList']>('/sign-in-options')
export type UsageRow = components['schemas']['UsageRow']
export const listUsage = () => request<components['schemas']['UsageList']>('/usage').then((r) => r.data)
export type AuditEntry = components['schemas']['AuditEntry']
export type AuditGroup = AuditEntry['group']
export type AuditPage = components['schemas']['AuditPage']
// The admin audit log (owners only), a page at a time.
export const listAudit = (q: { group?: AuditGroup; teamId?: string; cursor?: string }) => {
  const params = new URLSearchParams()
  if (q.group) params.set('group', q.group)
  if (q.teamId) params.set('teamId', q.teamId)
  if (q.cursor) params.set('cursor', q.cursor)
  const qs = params.toString()
  return request<AuditPage>(`/audit${qs ? `?${qs}` : ''}`)
}
export type Member = components['schemas']['Member']
export type MemberRole = Member['role']
// Experience categories: the shared list of what research is about.
export type Area = components['schemas']['Area']
export const listAreas = () => request<components['schemas']['AreaList']>('/areas')
export type AreaProposal = components['schemas']['AreaProposal']
export const listAreaProposals = () => request<components['schemas']['AreaProposalList']>('/areas/proposals').then((r) => r.data)
export const acceptAreaProposal = (key: string, name?: string) => request<components['schemas']['AcceptedAreaProposal']>('/areas/proposals/accept', { method: 'POST', body: { key, name: name ?? null } })
export const dismissAreaProposal = (key: string) => request<null>('/areas/proposals/dismiss', { method: 'POST', body: { key } })
export const createArea = (body: components['schemas']['CreateAreaRequest']) => request<Area>('/areas', { method: 'POST', body })
export const updateArea = (id: string, version: number, body: components['schemas']['UpdateAreaRequest']) => request<Area>(`/areas/${id}`, { method: 'PATCH', body, version })
export const mergeArea = (id: string, intoId: string) => request<Area>(`/areas/${id}/merge`, { method: 'POST', body: { intoId } })
export const retireArea = (id: string) => request<Area>(`/areas/${id}/retire`, { method: 'POST' })
export const listMembers = () => request<components['schemas']['MemberList']>('/members')
export const inviteMember = (input: components['schemas']['InviteMemberRequest']) => request<Member>('/members', { method: 'POST', body: input })
export const changeMemberRole = (id: string, role: MemberRole) => request<Member>(`/members/${id}`, { method: 'PATCH', body: { role } })
export const removeMember = (id: string) => request<null>(`/members/${id}`, { method: 'DELETE' })
export const setMemberExternal = (id: string, external: boolean) => request<Member>(`/members/${id}`, { method: 'PATCH', body: { external } })

// A launch: one per project, answered step by step by each step's reviewer.
export type LaunchDetail = components['schemas']['LaunchDetail']
export type LaunchStep = components['schemas']['LaunchStep']
export type LaunchAnswer = components['schemas']['LaunchAnswer']
export type LaunchListItem = components['schemas']['LaunchListItem']
export type ProjectLaunch = components['schemas']['ProjectLaunch']
export type LaunchAnswerInput = components['schemas']['LaunchAnswerRequest']
export type SetUpLaunchInput = components['schemas']['SetUpLaunchRequest']
export const getProjectLaunch = (projectId: string) => request<ProjectLaunch>(`/projects/${projectId}/launch`)
export const createLaunch = (projectId: string, body: components['schemas']['CreateLaunchRequest']) => request<LaunchDetail>(`/projects/${projectId}/launch`, { method: 'POST', body })
export const getLaunch = (id: string) => request<LaunchDetail>(`/launches/${id}`)
export const listLaunches = () => request<components['schemas']['LaunchList']>('/launches')
export const setUpLaunch = (id: string, body: SetUpLaunchInput) => request<LaunchDetail>(`/launches/${id}`, { method: 'PATCH', body })
export const answerLaunchStep = (id: string, step: string, body: LaunchAnswerInput) => request<LaunchDetail>(`/launches/${id}/steps/${step}`, { method: 'PUT', body })
export const addLaunchLink = (id: string, step: string, body: { title?: string; url: string }) => request<LaunchDetail>(`/launches/${id}/steps/${step}/links`, { method: 'POST', body })
export type LaunchRequestResult = components['schemas']['LaunchRequestResult']
export const requestLaunchAnswers = (id: string) => request<LaunchRequestResult>(`/launches/${id}/request`, { method: 'POST' })
export const removeLaunchLink = (id: string, linkId: string) => request<LaunchDetail>(`/launches/${id}/links/${linkId}`, { method: 'DELETE' })

// Launch reviewers: standing assignments, the coverage grid, and which steps each team uses.
export type ReviewerOverview = components['schemas']['ReviewerOverview']
export type ReviewerAssignment = components['schemas']['ReviewerAssignment']
export type CoverageCell = components['schemas']['CoverageCell']
export type ReviewerRole = ReviewerAssignment['role']
export type AddReviewerInput = components['schemas']['AddReviewerRequest']
export const getReviewers = () => request<ReviewerOverview>('/reviewers')
export const addReviewer = (input: components['schemas']['AddReviewerRequest']) => request<ReviewerOverview>('/reviewers', { method: 'POST', body: input })
export const removeReviewer = (id: string) => request<ReviewerOverview>(`/reviewers/${id}`, { method: 'DELETE' })
export const setTeamLaunchSteps = (id: string, used: Record<string, boolean>) => request<ReviewerOverview>(`/teams/${id}/launch-steps`, { method: 'PUT', body: { used } })
// Teams: leaders (workspace owners) manage them.
export type Team = components['schemas']['Team']
export const listTeams = () => request<components['schemas']['TeamList']>('/teams')
export const createTeam = (name: string) => request<Team>('/teams', { method: 'POST', body: { name } })
export const renameTeam = (id: string, name: string) => request<Team>(`/teams/${id}`, { method: 'PATCH', body: { name } })
export const deleteTeam = (id: string) => request<null>(`/teams/${id}`, { method: 'DELETE' })
export const setTeamMember = (id: string, memberId: string, role: MemberRole) => request<Team>(`/teams/${id}/members/${memberId}`, { method: 'PUT', body: { role } })
export const removeTeamMember = (id: string, memberId: string) => request<null>(`/teams/${id}/members/${memberId}`, { method: 'DELETE' })
export const moveProjectToTeam = (id: string, projectId: string) => request<Team>(`/teams/${id}/projects/${projectId}`, { method: 'PUT' })
export type Template = components['schemas']['Template']
export type CreateProjectRequest = components['schemas']['CreateProjectRequest']
export const listTemplates = () => request<components['schemas']['TemplateList']>('/templates')
export const createProject = (input: CreateProjectRequest) => request<Project>('/projects', { method: 'POST', body: input })
export const deleteProject = (id: string) => request<null>(`/projects/${id}`, { method: 'DELETE' })
export type ProjectDetail = components['schemas']['ProjectDetail']
export type StageInfo = components['schemas']['StageInfo']
export type StepKey = keyof StageInfo['tabs']
export const getProject = (id: string) => request<ProjectDetail>(`/projects/${id}`)
export const getProjectStage = (id: string) => request<StageInfo>(`/projects/${id}/stage`)
// Saves send the version the person was looking at; a 409 means someone else saved first.
export const saveStudy = (id: string, version: number, body: components['schemas']['SavePlanRequest']) => request<ProjectDetail>(`/projects/${id}/study`, { method: 'PUT', body, version })
export const saveTasks = (id: string, version: number, body: components['schemas']['SaveTasksRequest']) => request<ProjectDetail>(`/projects/${id}/tasks`, { method: 'PUT', body, version })
export type TranscriptList = components['schemas']['TranscriptList']
export type AnalysisRunResult = components['schemas']['AnalysisRunResult']
export const getTranscripts = (id: string) => request<TranscriptList>(`/projects/${id}/transcripts`)
export const saveTranscripts = (id: string, version: number, body: components['schemas']['SaveTranscriptsRequest']) => request<TranscriptList>(`/projects/${id}/transcripts`, { method: 'PUT', body, version })
export const startAnalysis = (id: string, version: number) => request<AnalysisRunResult>(`/projects/${id}/analysis-runs`, { method: 'POST', body: {}, version })
export type Theme = components['schemas']['Theme']
export type ThemePatch = components['schemas']['ThemePatch']
export type ThemeList = components['schemas']['ThemeList']
export type ThemeCategory = Theme['category']
export const listThemes = (projectId: string) => request<ThemeList>(`/projects/${projectId}/themes?include=quotes`)
// An edit is checked against the version of that theme's edits, so edits to other themes never conflict.
// Files a theme under an experience category, or none.
export const setThemeArea = (themeId: string, areaId: string | null) => request<Theme>(`/themes/${themeId}/area`, { method: 'PUT', body: { areaId } })
export const updateTheme = (themeId: string, version: number, body: ThemePatch) => request<Theme>(`/themes/${themeId}`, { method: 'PATCH', body, version })
export const resetPriorityOverrides = (projectId: string) => request<{ data: Theme[] }>(`/projects/${projectId}/priority-overrides`, { method: 'DELETE' })
export type SpecDetail = components['schemas']['SpecDetail']
export type SpecSummary = components['schemas']['SpecSummary']
export type SpecStep = SpecDetail['steps'][number]
export type PublishResult = components['schemas']['PublishResult']
export const listSpecs = (filter: { projectId?: string; standalone?: boolean } = {}) =>
  request<{ data: SpecSummary[] }>(`/specs${filter.projectId ? `?projectId=${filter.projectId}` : filter.standalone ? '?standalone=true' : ''}`).then((r) => r.data)
export const getSpec = (id: string) => request<SpecDetail>(`/specs/${id}`)
export const createSpec = (projectId: string, name?: string) => request<SpecDetail>(`/projects/${projectId}/specs`, { method: 'POST', body: name ? { name } : {} })
export const setSpecTheme = (specId: string, themeId: string, version: number, included: boolean) => request<SpecDetail>(`/specs/${specId}/themes/${themeId}`, { method: 'PUT', body: { included }, version })
// Step actions carry the step's own version, so two people reviewing the same step cannot both succeed.
// Approving makes only the approval; the next step is then started with draftWaitingStep, so the page can show each in turn.
export const approveStep = (stepId: string, version: number) => request<SpecDetail>(`/agent-steps/${stepId}/approve?draftNext=false`, { method: 'POST', version })
export const draftWaitingStep = (stepId: string, version: number) => request<SpecDetail>(`/agent-steps/${stepId}/draft`, { method: 'POST', version })
export const redoStep = (stepId: string, version: number, instructions: string) => request<SpecDetail>(`/agent-steps/${stepId}/redo`, { method: 'POST', body: { instructions }, version })
export const editStep = (stepId: string, version: number, text: string) => request<SpecDetail>(`/agent-steps/${stepId}`, { method: 'PATCH', body: { text }, version })
export const publishSpec = (specId: string, version: number) => request<PublishResult>(`/specs/${specId}/publish`, { method: 'POST', version })
export type BoardSyncPlan = components['schemas']['BoardSyncPlan']
export const syncBoard = (specId: string, apply: boolean) => request<BoardSyncPlan>(`/specs/${specId}/board-sync`, { method: 'POST', body: { apply } })
export const deleteSpec = (specId: string) => request<null>(`/specs/${specId}`, { method: 'DELETE' })
export const listProjects = () => request<components['schemas']['ProjectList']>('/projects').then((r) => r.data)

// What to tell a person for each error code the API can return.
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'db_unavailable') return 'The demo database is paused. It wakes on the next request, or when the monthly limit resets.'
    if (err.code === 'auth_not_configured') return 'Sign-in is not set up yet, so data routes are closed on this deployment.'
    if (err.code === 'unauthorized') return 'The access token was missing or not accepted.'
    if (err.code === 'forbidden') return 'Your role cannot make changes.'
    if (err.code === 'version_conflict') return 'Someone else changed this since you opened it. It has been reloaded.'
    if (err.code === 'not_found') return 'That project no longer exists.'
    if (err.code === 'no_transcripts') return 'Add at least one transcript before analyzing.'
    if (err.code === 'no_analysis') return 'Analyze the transcripts first: a document is built from the themes.'
    if (err.code === 'spec_published') return 'This document is already published. Use Update board to bring the board in line with it.'
    if (err.code === 'not_published') return 'Publish the document first: the board is made from it.'
    if (err.code === 'step_not_ready') return 'That step is not ready for this action yet.'
    if (err.code === 'steps_not_approved') return 'Every step must be approved before publishing.'
    if (err.code === 'no_board') return 'Publish a requirements document to put its stories on the board.'
    if (err.code === 'nothing_to_undo') return 'There is no move of yours to undo.'
    if (err.code === 'cannot_undo') return 'That card has moved again since, so the move cannot be undone.'
    if (err.code === 'theme_superseded') return 'These themes are from an earlier analysis. They have been reloaded.'
    if (err.code === 'workspace_not_found') return 'The demo data is not loaded yet.'
    return err.message
  }
  return 'The API did not respond.'
}

// The Stories board ---------------------------------------------------------------------------------
export type Board = components['schemas']['Board']
export type BoardStory = components['schemas']['BoardStory']
export type StoryDetail = components['schemas']['StoryDetail']
export type ChecklistItem = components['schemas']['ChecklistItem']
export type StoryStatus = BoardStory['status']
export type Priority = BoardStory['priority']
export type ChecklistInput = components['schemas']['SaveChecklistRequest']['items'][number]
export const getBoard = (projectId: string) => request<Board>(`/projects/${projectId}/board`)
export type Ticket = components['schemas']['Ticket']
export type CreateTicketInput = components['schemas']['CreateTicketRequest']
export const listTickets = (projectId: string) => request<components['schemas']['TicketList']>(`/projects/${projectId}/tickets`)
export type JiraStatus = components['schemas']['JiraStatus']
export const getJiraStatus = () => request<JiraStatus>('/integrations/jira')
export const createTicket = (storyId: string, input: CreateTicketInput) => request<Ticket>(`/stories/${storyId}/tickets`, { method: 'POST', body: input })
export const getStory = (id: string) => request<StoryDetail>(`/stories/${id}`)
export const moveStory = (id: string, version: number, status: StoryStatus, beforeId: string | null) =>
  request<StoryDetail>(`/stories/${id}/move`, { method: 'POST', body: { status, beforeId }, version })
export const undoMove = (specId: string) => request<StoryDetail>(`/specs/${specId}/undo`, { method: 'POST' })
export const patchStory = (id: string, version: number, body: { ownerTeam?: string | null; priority?: Priority }) =>
  request<StoryDetail>(`/stories/${id}`, { method: 'PATCH', body, version })
export const saveChecklist = (id: string, version: number, items: ChecklistInput[]) =>
  request<StoryDetail>(`/stories/${id}/checklist`, { method: 'PUT', body: { items }, version })

// Platform Insights -----------------------------------------------------------------------------------
export type InsightsThemes = components['schemas']['InsightsThemes']
export type PlatformThemeRow = InsightsThemes['themes'][number]
export type MergeRecord = components['schemas']['MergeRecord']
export type InsightRecommendation = InsightsThemes['recommendations'][number]
export type PlatformThemeDetail = components['schemas']['PlatformThemeDetail']
export type CaseStudy = components['schemas']['CaseStudy']
export type Customers = components['schemas']['Customers']
export const getCustomers = () => request<Customers>('/insights/customers')
export type PlatformJourney = components['schemas']['PlatformJourney']
export const getPlatformJourney = (workflowId?: string) => request<PlatformJourney>(`/insights/journey${workflowId ? `?workflow=${workflowId}` : ''}`)
// Workflows: the service blueprint. A workflow is saved whole, against its version.
export type Workflow = components['schemas']['Workflow']
export type WorkflowStage = components['schemas']['WorkflowStage']
export type WorkflowBackstage = components['schemas']['WorkflowBackstage']
export type WorkflowRequest = components['schemas']['WorkflowRequest']
export type ProjectBlueprint = components['schemas']['ProjectBlueprint']
export type WorkflowList = components['schemas']['WorkflowList']
export const listWorkflows = () => request<WorkflowList>('/workflows')
export const addSampleWorkflows = () => request<WorkflowList>('/workflows/sample', { method: 'POST' })
export const createWorkflow = (body: WorkflowRequest) => request<Workflow>('/workflows', { method: 'POST', body })
export const saveWorkflow = (id: string, version: number, body: WorkflowRequest) => request<Workflow>(`/workflows/${id}`, { method: 'PUT', body, version })
export const deleteWorkflow = (id: string) => request<null>(`/workflows/${id}`, { method: 'DELETE' })
export const getProjectBlueprint = (projectId: string) => request<ProjectBlueprint>(`/projects/${projectId}/blueprint`)
export const setProjectWorkflow = (projectId: string, workflowId: string | null) => request<ProjectBlueprint>(`/projects/${projectId}/workflow`, { method: 'PUT', body: { workflowId } })
export const mapProjectStage = (projectId: string, position: number, workflowStageId: string | null) => request<ProjectBlueprint>(`/projects/${projectId}/stage-map`, { method: 'PUT', body: { position, workflowStageId } })
export type CaseBrief = components['schemas']['CaseBrief']
export const listCaseBriefs = () => request<{ data: CaseBrief[] }>('/insights/case-briefs').then((r) => r.data)
export type Storyboard = components['schemas']['Storyboard']
export const getStoryboard = (projectId: string) => request<Storyboard>(`/projects/${projectId}/storyboard`)
export const generateStoryboard = (projectId: string) => request<Storyboard>(`/projects/${projectId}/storyboard/generate`, { method: 'POST' })
export const getCaseBrief = (projectId: string) => request<CaseBrief>(`/projects/${projectId}/case-study-brief`)
export const getInsightsThemes = () => request<InsightsThemes>('/insights/themes')
export const renamePlatformTheme = (id: string, title: string) => request<components['schemas']['PlatformThemeRef']>(`/insights/themes/${id}`, { method: 'PATCH', body: { title } })
export const mergePlatformTheme = (id: string, intoId: string) => request<components['schemas']['PlatformThemeRef']>(`/insights/themes/${id}/merge`, { method: 'POST', body: { intoId } })
export const findMergeSuggestions = () => request<{ added: number; fallback?: 'budget' | 'credit' }>('/insights/merge-suggestions/run', { method: 'POST' })
export const acceptMergeSuggestion = (id: string) => request<components['schemas']['PlatformThemeRef']>(`/insights/merge-suggestions/${id}/accept`, { method: 'POST' })
export const dismissMergeSuggestion = (id: string) => request<null>(`/insights/merge-suggestions/${id}/dismiss`, { method: 'POST' })
export const assignPlatformThemeArea = (id: string, areaId: string) => request<{ filed: number }>(`/insights/themes/${id}/area`, { method: 'PUT', body: { areaId } })
export const clearPlatformThemeArea = (id: string) => request<{ cleared: number }>(`/insights/themes/${id}/area`, { method: 'DELETE' })
export const listMerges = () => request<components['schemas']['MergeList']>('/insights/merges').then((r) => r.data)
export const undoMerge = (id: string) => request<components['schemas']['PlatformThemeRef']>(`/insights/merges/${id}/undo`, { method: 'POST' })
export const writeRankRationales = () => request<{ written: number; fallback?: 'budget' | 'credit' }>('/insights/roadmap/rationale', { method: 'POST' })
export const markThemeReviewed = (id: string) => request<null>(`/insights/themes/${id}/reviewed`, { method: 'POST' })
export const getPlatformTheme = (id: string) => request<PlatformThemeDetail>(`/insights/themes/${id}`)
export const listCaseStudies = () => request<{ data: CaseStudy[] }>('/insights/case-studies').then((r) => r.data)
