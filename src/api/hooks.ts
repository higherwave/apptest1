import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import {
  getAiStatus, getNotificationPreferences, saveNotificationPreferences, sendReminderNow, getStoryboard, generateStoryboard, listCaseBriefs, getCustomers, getPlatformJourney, getInsightsThemes, getPlatformTheme, listCaseStudies, markThemeReviewed, listMerges, undoMerge, assignPlatformThemeArea, clearPlatformThemeArea, renamePlatformTheme, mergePlatformTheme, findMergeSuggestions, acceptMergeSuggestion, dismissMergeSuggestion, writeRankRationales,
  getMySlack, createSlackConnectCode, disconnectMySlack, requestLaunchAnswers, startLaunchSlackThread, getProjectLaunch, getProjectLock, createLaunch, getLaunch, getLaunchSuccess, getSetup, markSetup, listLaunches, setUpLaunch, answerLaunchStep, addLaunchLink, removeLaunchLink, getBoard, listTickets, createTicket, getJiraStatus, getDesign, saveDesignItem, captureDesignImage, getMeasureAcross, saveMeasureItem, getStory, moveStory, undoMove, patchStory, saveChecklist,
  addSampleWorkflows, createWorkflow, deleteWorkflow, getProjectBlueprint, listWorkflows, mapProjectStage, saveWorkflow, setProjectWorkflow,
  changeMember, getApprovals, saveApprovalStep, setApproverAway, inviteMember, listAudit, listUsage, listMembers, removeMember, listTeams, createTeam, saveTeam, deleteTeam,
  createProject, listAreaProposals, acceptAreaProposal, dismissAreaProposal, deleteProject, listHolds, placeHold, releaseHold, listTrash, restoreFromTrash, deleteFromTrash, listAreas, createArea, updateArea, mergeArea, retireArea, getMe, getSignInOptions, getProject, getSpec, listSpecs, getProjectStage, getTranscripts, listProjects, listTemplates, saveStudy, saveTasks, saveTranscripts, startAnalysis,
  type AuditGroup, type LaunchAnswerInput, type LaunchDetail, type SetUpLaunchInput, type WorkflowRequest, type DesignRequest, type MeasureRequest, type MemberRole, type Board, type BoardStory, type ChecklistInput, type CreateProjectRequest, type Priority, type ProjectDetail, type StoryStatus,
  getPulsePreview, setPulsePreview, listPulseSignals, addPulseSignal, importPulseNotes, updatePulseSignal, listPulseTopics, updatePulseTopics, renamePulseTopic, mergePulseTopic, getPulseWeights, setPulseWeights, getPulseSalesforce, syncPulseSalesforce, listPulseViewers, setPulseViewer, listPulseSources, addPulseSource, addPulseOpportunitySource, updatePulseSource, removePulseSource, checkPulseSource, getPulseTopic, suggestPulseQuestions, createPulseProject, getPulseOrigin, type PulseWeights, type SignalOrigin, type NewPulseSignal, type PulseSignal, type PulseStatus,
} from './client'
import { moved } from '../../shared/board.mjs'
import { getToken, subscribeToken } from './token'

// One hook per operation. Pages bind to these, never to fetch.
export const useToken = () => useSyncExternalStore(subscribeToken, getToken)

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: listProjects })
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: listTemplates, staleTime: 5 * 60_000 })
// The role depends on whether the tab holds a token, so the token is part of the key.
export const useMe = () => {
  const token = useToken()
  return useQuery({ queryKey: ['me', token], queryFn: () => getMe() })
}

// The workspace's experience categories. Every change refetches the list: usage counts and aliases move together.
export const useAreas = () => useQuery({ queryKey: ['areas'], queryFn: listAreas, staleTime: 60_000 })
export const useCreateArea = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (body: Parameters<typeof createArea>[0]) => createArea(body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas'] }) })
}
export const useAreaProposals = (enabled = true) => useQuery({ queryKey: ['areas', 'proposals'], queryFn: listAreaProposals, enabled })
// Accepting adds an area and files themes under it, so every list that shows either is refreshed.
export const useAcceptAreaProposal = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { key: string; name?: string }) => acceptAreaProposal(v.key, v.name), onSuccess: () => queryClient.invalidateQueries() })
}
export const useDismissAreaProposal = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (key: string) => dismissAreaProposal(key), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas'] }) })
}
export const useUpdateArea = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { id: string; version: number; body: Parameters<typeof updateArea>[2] }) => updateArea(v.id, v.version, v.body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas'] }) })
}
export const useMergeArea = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { id: string; intoId: string }) => mergeArea(v.id, v.intoId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas'] }) })
}
export const useRetireArea = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => retireArea(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas'] }) })
}

// Which ways to sign in this deployment offers (public, so it works before anyone is signed in).
export const useSignInOptions = () => useQuery({ queryKey: ['sign-in-options'], queryFn: getSignInOptions, staleTime: 5 * 60_000 })

export const useUsage = () => useQuery({ queryKey: ['usage'], queryFn: listUsage })
export const useAudit = (group?: AuditGroup, teamId?: string, since?: string) =>
  useInfiniteQuery({
    queryKey: ['audit', group ?? 'all', teamId ?? 'all', since ?? 'all'],
    queryFn: ({ pageParam }) => listAudit({ group, teamId, since, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: listMembers })
// People: every change can move a person between teams or end approvals, so each refreshes members, teams, approvals, the audit log and who I am.
const PEOPLE_KEYS = ['members', 'teams', 'approvals', 'audit', 'me', 'projects']
function usePeopleMutation<T, R>(fn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(PEOPLE_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))) })
}
export const useInviteMember = () => usePeopleMutation((input: Parameters<typeof inviteMember>[0]) => inviteMember(input))
export const useChangeMember = () => usePeopleMutation(({ id, body }: { id: string; body: Parameters<typeof changeMember>[1] }) => changeMember(id, body))
export const useRemoveMember = () => usePeopleMutation((id: string) => removeMember(id))

// Teams. Every change can move people and projects between teams, so each refreshes the teams, the project list and who I am.
// A launch (one per project). A mutation returns the launch as the caller now sees it, which replaces the cached copy.
/** Whether the project is locked because its requirements are published, and whether the caller may return them to draft. */
/** Workspace setup (the guided onboarding), owners only. */
export const useSetup = (enabled = true) => useQuery({ queryKey: ['setup'], queryFn: getSetup, enabled })
export const useMarkSetup = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: ({ step, status, acknowledged }: { step: string; status: 'done' | 'skipped'; acknowledged?: boolean[] }) => markSetup(step, status, acknowledged), onSuccess: (data) => queryClient.setQueryData(['setup'], data) })
}
/** The launch's "How will we know it worked?" view (read-only). */
export const useLaunchSuccess = (launchId: string | undefined) => useQuery({ queryKey: ['launch-success', launchId], queryFn: () => getLaunchSuccess(launchId!), enabled: !!launchId })
export const useProjectLock = (projectId: string | undefined) => useQuery({ queryKey: ['project-lock', projectId], queryFn: () => getProjectLock(projectId!), enabled: !!projectId })
export const useProjectLaunch = (projectId: string | undefined) => useQuery({ queryKey: ['project-launch', projectId], queryFn: () => getProjectLaunch(projectId!), enabled: !!projectId })
export const useLaunch = (id: string | undefined) => useQuery({ queryKey: ['launch', id], queryFn: () => getLaunch(id!), enabled: !!id, retry: false })
export const useLaunches = (enabled = true) => useQuery({ queryKey: ['launches'], queryFn: listLaunches, enabled })
function useLaunchMutation<T>(fn: (input: T) => Promise<LaunchDetail>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (launch) => {
      queryClient.setQueryData(['launch', launch.id], launch)
      return Promise.all(['launches', 'project-launch', 'audit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    },
  })
}
export const useCreateLaunch = (projectId: string) => useLaunchMutation((body: { name?: string; targetDate?: string | null }) => createLaunch(projectId, body))
export const useSetUpLaunch = () => useLaunchMutation(({ id, body }: { id: string; body: SetUpLaunchInput }) => setUpLaunch(id, body))
export const useAnswerLaunchStep = () => useLaunchMutation(({ id, step, body }: { id: string; step: string; body: LaunchAnswerInput }) => answerLaunchStep(id, step, body))
export const useAddLaunchLink = () => useLaunchMutation(({ id, step, body }: { id: string; step: string; body: { title?: string; url: string } }) => addLaunchLink(id, step, body))
// Asks the reviewers of the steps still waiting, by email. Nothing in the launch itself changes, so nothing is refreshed.
export const useRequestLaunchAnswers = () => useMutation({ mutationFn: (id: string) => requestLaunchAnswers(id) })
// Opens the launch's Slack thread; the launch is refreshed so its link shows.
export const useStartLaunchSlackThread = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => startLaunchSlackThread(id),
    onSuccess: () => Promise.all(['launch', 'launches', 'project-launch'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  })
}
// The caller's Slack connection (for the account panel), the one-time code to connect it, and undoing it.
export const useMySlack = () => useQuery({ queryKey: ['my-slack'], queryFn: getMySlack, staleTime: 60_000 })
export const useCreateSlackConnectCode = () => useMutation({ mutationFn: createSlackConnectCode })
export const useDisconnectMySlack = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: disconnectMySlack, onSuccess: (data) => queryClient.setQueryData(['my-slack'], data) })
}
export const useRemoveLaunchLink = () => useLaunchMutation(({ id, linkId }: { id: string; linkId: string }) => removeLaunchLink(id, linkId))

// Launch approvers (owners only): who approves which step; each change returns the new grid.
export const useApprovals = (enabled = true) => useQuery({ queryKey: ['approvals'], queryFn: getApprovals, enabled })
function useApprovalMutation<T>(fn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['approvals', 'members', 'audit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))) })
}
export const useSaveApprovalStep = () => useApprovalMutation(({ step, input }: { step: string; input: Parameters<typeof saveApprovalStep>[1] }) => saveApprovalStep(step, input))
export const useSetApproverAway = () => useApprovalMutation(({ userId, unavailable }: { userId: string; unavailable: boolean }) => setApproverAway(userId, unavailable))

export const useTeams = () => useQuery({ queryKey: ['teams'], queryFn: listTeams })
function useTeamMutation<T>(fn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(['teams', 'projects', 'me', 'members', 'approvals', 'audit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  })
}
export const useCreateTeam = () => useTeamMutation((input: Parameters<typeof createTeam>[0]) => createTeam(input))
export const useSaveTeam = () => useTeamMutation(({ id, body }: { id: string; body: Parameters<typeof saveTeam>[1] }) => saveTeam(id, body))
export const useDeleteTeam = () => useTeamMutation((id: string) => deleteTeam(id))

export const useAiStatus = () => {
  const token = useToken()
  return useQuery({ queryKey: ['ai-status', token], queryFn: getAiStatus, staleTime: 60_000 })
}

export const useCreateProject = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: CreateProjectRequest) => createProject(input), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }) })
}

export const useDeleteProject = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, permanent }: { id: string; permanent?: boolean }) => deleteProject(id, permanent),
    onSuccess: () => Promise.all(['projects', 'trash'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  })
}

export const useProject = (id: string | undefined) => useQuery({ queryKey: ['project', id], queryFn: () => getProject(id!), enabled: !!id })
export const useProjectStage = (id: string | undefined) => useQuery({ queryKey: ['stage', id], queryFn: () => getProjectStage(id!), enabled: !!id })

// A save returns the project as it is now; it replaces the cached copy, so the next save uses the new version.
type SaveVars<B> = { version: number; body: B }
function useSave<B>(id: string, save: (id: string, version: number, body: B) => Promise<ProjectDetail>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ version, body }: SaveVars<B>) => save(id, version, body),
    onSuccess: (detail) => {
      queryClient.setQueryData(['project', id], detail)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
export const useSaveStudy = (id: string) => useSave(id, saveStudy)
export const useSaveTasks = (id: string) => useSave(id, saveTasks)

export const useTranscripts = (id: string | undefined) => useQuery({ queryKey: ['transcripts', id], queryFn: () => getTranscripts(id!), enabled: !!id })
// Transcript and analysis calls change the project's version, so the caller reads the project again afterwards.
export const transcriptApi = { save: saveTranscripts, analyze: startAnalysis, project: getProject }

export const useSpecs = (filter: { projectId?: string; standalone?: boolean }) => useQuery({ queryKey: ['specs', filter], queryFn: () => listSpecs(filter) })
export const useSpec = (id: string | undefined) => useQuery({ queryKey: ['spec', id], queryFn: () => getSpec(id!), enabled: !!id })

// The Stories board. A move shows at once (the card is placed where it was dropped) and the API's answer
// replaces the guess; if the API refuses, the board is read again.
export const useBoard = (projectId: string | undefined) => useQuery({ queryKey: ['board', projectId], queryFn: () => getBoard(projectId!), enabled: !!projectId, retry: false })
export const useTickets = (projectId: string | undefined) => useQuery({ queryKey: ['tickets', projectId], queryFn: () => listTickets(projectId!), enabled: !!projectId })
// What the Create ticket dialog offers; only owners and editors may ask, and it is read from Jira at most every five minutes by the server.
export const useJiraStatus = (enabled: boolean) => useQuery({ queryKey: ['jira-status'], queryFn: getJiraStatus, enabled, staleTime: 5 * 60_000, retry: false })
export const useCreateTicket = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { storyId: string; input: import('./client').CreateTicketInput }) => createTicket(v.storyId, v.input), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tickets', projectId] }) })
}
export const useStory = (id: string | null) => useQuery({ queryKey: ['story', id], queryFn: () => getStory(id!), enabled: !!id })

export function useMoveStory(projectId: string) {
  const queryClient = useQueryClient()
  const key = ['board', projectId]
  return useMutation({
    mutationFn: (v: { story: BoardStory; status: StoryStatus; beforeId: string | null }) => moveStory(v.story.id, v.story.version, v.status, v.beforeId),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<Board>(key, (b) => (b ? { ...b, stories: moved(b.stories, v.story.id, v.status, v.beforeId) } : b))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
      queryClient.invalidateQueries({ queryKey: ['story'] })
    },
  })
}

export function useUndoMove(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (specId: string) => undoMove(specId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board', projectId] })
      queryClient.invalidateQueries({ queryKey: ['story'] })
    },
  })
}

// Edits to one card. The answer is the card as it is now; it replaces the open copy and the board refreshes.
function useStoryEdit<V>(projectId: string, save: (v: V) => Promise<import('./client').StoryDetail>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: save,
    onSuccess: (detail) => queryClient.setQueryData(['story', detail.id], detail),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['board', projectId] }),
  })
}
export const usePatchStory = (projectId: string) => useStoryEdit(projectId, (v: { id: string; version: number; body: { ownerTeam?: string | null; priority?: Priority } }) => patchStory(v.id, v.version, v.body))
export const useSaveChecklist = (projectId: string) => useStoryEdit(projectId, (v: { id: string; version: number; items: ChecklistInput[] }) => saveChecklist(v.id, v.version, v.items))

// Platform Insights: read-only, so plain queries.
export const useInsightsThemes = () => useQuery({ queryKey: ['insights', 'themes'], queryFn: getInsightsThemes })
export const usePlatformTheme = (id: string | null) => useQuery({ queryKey: ['insights', 'theme', id], queryFn: () => getPlatformTheme(id!), enabled: !!id })
export const useMarkThemeReviewed = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => markThemeReviewed(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['insights'] }) })
}
// Keeping platform themes tidy: each action changes the themes, so every Platform Insights query is refreshed afterwards.
export const useThemeCuration = () => {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['insights'] })
  return {
    rename: useMutation({ mutationFn: (v: { id: string; title: string }) => renamePlatformTheme(v.id, v.title), onSuccess: refresh }),
    merge: useMutation({ mutationFn: (v: { id: string; intoId: string }) => mergePlatformTheme(v.id, v.intoId), onSuccess: refresh }),
    find: useMutation({ mutationFn: () => findMergeSuggestions(), onSuccess: refresh }),
    accept: useMutation({ mutationFn: (id: string) => acceptMergeSuggestion(id), onSuccess: refresh }),
    dismiss: useMutation({ mutationFn: (id: string) => dismissMergeSuggestion(id), onSuccess: refresh }),
    assignArea: useMutation({ mutationFn: (v: { themeId: string; areaId: string }) => assignPlatformThemeArea(v.themeId, v.areaId), onSuccess: () => queryClient.invalidateQueries() }),
    clearArea: useMutation({ mutationFn: (id: string) => clearPlatformThemeArea(id), onSuccess: () => queryClient.invalidateQueries() }),
    undo: useMutation({ mutationFn: (id: string) => undoMerge(id), onSuccess: refresh }),
    rationale: useMutation({ mutationFn: () => writeRankRationales(), onSuccess: refresh }),
  }
}
export const useMerges = () => useQuery({ queryKey: ['insights', 'merges'], queryFn: listMerges })
export const useCustomers = () => useQuery({ queryKey: ['insights', 'customers'], queryFn: getCustomers })
export const usePlatformJourney = (workflowId?: string) => useQuery({ queryKey: ['insights', 'journey', workflowId ?? 'all'], queryFn: () => getPlatformJourney(workflowId) })

// Workflows (the service blueprint) and a project's place on one. Anything that changes one refreshes the others that read it.
export const useWorkflows = () => useQuery({ queryKey: ['workflows'], queryFn: listWorkflows })
const refreshBlueprints = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['workflows'] }), queryClient.invalidateQueries({ queryKey: ['insights', 'journey'] }), queryClient.invalidateQueries({ queryKey: ['blueprint'] }), queryClient.invalidateQueries({ queryKey: ['audit'] })])
export const useAddSampleWorkflows = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: () => addSampleWorkflows(), onSuccess: () => refreshBlueprints(queryClient) })
}
export const useCreateWorkflow = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (body: WorkflowRequest) => createWorkflow(body), onSuccess: () => refreshBlueprints(queryClient) })
}
export const useSaveWorkflow = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: ({ id, version, body }: { id: string; version: number; body: WorkflowRequest }) => saveWorkflow(id, version, body), onSuccess: () => refreshBlueprints(queryClient) })
}
export const useDeleteWorkflow = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => deleteWorkflow(id), onSuccess: () => Promise.all([refreshBlueprints(queryClient), queryClient.invalidateQueries({ queryKey: ['trash'] })]) })
}
export const useProjectBlueprint = (projectId: string | undefined) => useQuery({ queryKey: ['blueprint', projectId], queryFn: () => getProjectBlueprint(projectId!), enabled: !!projectId })
export const useSetProjectWorkflow = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (workflowId: string | null) => setProjectWorkflow(projectId, workflowId), onSuccess: () => refreshBlueprints(queryClient) })
}
export const useMapProjectStage = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: ({ position, workflowStageId }: { position: number; workflowStageId: string | null }) => mapProjectStage(projectId, position, workflowStageId), onSuccess: () => refreshBlueprints(queryClient) })
}
// The header counts them on every Platform Insights tab, so they are kept for half a minute instead of being rebuilt on each tab.
export const useStoryboard = (projectId: string) => useQuery({ queryKey: ['storyboard', projectId], queryFn: () => getStoryboard(projectId) })
export const useGenerateStoryboard = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => generateStoryboard(projectId),
    onSuccess: (board) => {
      queryClient.setQueryData(['storyboard', projectId], board)
      return queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}
export const useCaseBriefs = () => useQuery({ queryKey: ['insights', 'briefs'], queryFn: listCaseBriefs, staleTime: 30_000 })
export const useCaseStudies = () => useQuery({ queryKey: ['insights', 'case-studies'], queryFn: listCaseStudies })

// The Design table of a project. A save returns the row as it is now and is merged into the cached table.
export const useDesign = (projectId: string | undefined) => useQuery({ queryKey: ['design', projectId], queryFn: () => getDesign(projectId!), enabled: !!projectId })
export const useSaveDesign = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { storyId: string; version: number; body: DesignRequest }) => saveDesignItem(v.storyId, v.version, v.body),
    onSuccess: (item) => {
      queryClient.setQueryData(['design', projectId], (d: Awaited<ReturnType<typeof getDesign>> | undefined) => (d ? { ...d, items: d.items.map((i) => (i.storyId === item.storyId ? item : i)) } : d))
    },
  })
}

// A thumbnail taken from the prototype link; the cached table takes the row it returns, like a save.
export const useCaptureDesign = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { storyId: string; replace: boolean }) => captureDesignImage(v.storyId, v.replace),
    onSuccess: (item) => {
      queryClient.setQueryData(['design', projectId], (d: Awaited<ReturnType<typeof getDesign>> | undefined) => (d ? { ...d, items: d.items.map((i) => (i.storyId === item.storyId ? item : i)) } : d))
    },
  })
}

// The Measure table of a project. A save returns the row as it is now; the cached table takes it and counts the results again.
// Measure is a place of its own: the requirements of every project the person can see. Saving one row refreshes the list.
export const useMeasureAcross = () => useQuery({ queryKey: ['measure'], queryFn: getMeasureAcross, retry: false })
export const useSaveMeasure = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { storyId: string; version: number; body: MeasureRequest }) => saveMeasureItem(v.storyId, v.version, v.body),
    onSuccess: () => Promise.all(['measure', 'projects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  })
}

// The signed-in person's reminder settings. Saving refreshes them; sending a test reminder changes nothing here.
export const useNotificationPreferences = (enabled = true) => useQuery({ queryKey: ['notification-preferences'], queryFn: getNotificationPreferences, enabled })
export const useSaveNotificationPreferences = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (body: Parameters<typeof saveNotificationPreferences>[0]) => saveNotificationPreferences(body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }) })
}
export const useSendReminderNow = () => useMutation({ mutationFn: () => sendReminderNow() })


// The Trash: what the signed-in person may put back (owners see everything, an editor what they deleted).
export const useTrash = () => useQuery({ queryKey: ['trash'], queryFn: listTrash })
const TRASH_REFRESH = ['trash', 'projects', 'workflows', 'specs', 'insights', 'launches', 'measure']
export const useRestoreFromTrash = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => restoreFromTrash(id), onSuccess: () => Promise.all(TRASH_REFRESH.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))) })
}
export const useDeleteFromTrash = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => deleteFromTrash(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trash'] }) })
}

// Legal holds (owners).
export const useHolds = () => useQuery({ queryKey: ['holds'], queryFn: listHolds })
export const usePlaceHold = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: placeHold, onSuccess: () => Promise.all(['holds', 'audit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))) })
}
export const useReleaseHold = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => releaseHold(id), onSuccess: () => Promise.all(['holds', 'audit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))) })
}

/** Pulse (preview, owners only). The switch is read in Settings; the signals only load where the menu already showed Pulse. */
export const usePulsePreview = (enabled = true) => useQuery({ queryKey: ['pulse', 'preview'], queryFn: getPulsePreview, enabled })
export const useSetPulsePreview = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (enabled: boolean) => setPulsePreview(enabled), onSuccess: () => queryClient.invalidateQueries() })
}
export const usePulseSignals = (status?: PulseStatus, origin?: SignalOrigin) => useQuery({ queryKey: ['pulse', 'signals', status ?? 'all', origin ?? 'any'], queryFn: () => listPulseSignals(status, origin), retry: false })
const refreshPulse = (queryClient: ReturnType<typeof useQueryClient>) => queryClient.invalidateQueries({ queryKey: ['pulse', 'signals'] })
export const useAddPulseSignal = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (body: NewPulseSignal) => addPulseSignal(body), onSuccess: () => refreshPulse(queryClient) })
}
export const useImportPulseNotes = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (body: Parameters<typeof importPulseNotes>[0]) => importPulseNotes(body), onSuccess: () => refreshPulse(queryClient) })
}
export const useUpdatePulseSignal = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { id: string; status?: PulseStatus; kind?: PulseSignal['kind'] }) => updatePulseSignal(v.id, { status: v.status, kind: v.kind }), onSuccess: () => refreshPulse(queryClient) })
}

/** Pulse topics: ranked, with every number computed on the server from the kept signals and the channel weights. */
export const usePulseTopics = (enabled = true, origin?: SignalOrigin) => useQuery({ queryKey: origin ? ['pulse', 'topics', origin] : ['pulse', 'topics'], queryFn: () => listPulseTopics(origin), enabled, retry: false })
const setTopics = (queryClient: ReturnType<typeof useQueryClient>) => (data: Awaited<ReturnType<typeof listPulseTopics>>) => {
  queryClient.setQueryData(['pulse', 'topics'], data)
  void queryClient.invalidateQueries({ queryKey: ['pulse', 'signals'] })
}
export const useUpdatePulseTopics = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (mode: 'attach' | 'regroup' = 'attach') => updatePulseTopics(mode), onSuccess: setTopics(queryClient) })
}
export const useRenamePulseTopic = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { id: string; title: string }) => renamePulseTopic(v.id, v.title), onSuccess: setTopics(queryClient) })
}
export const useMergePulseTopic = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (v: { id: string; intoId: string }) => mergePulseTopic(v.id, v.intoId), onSuccess: setTopics(queryClient) })
}
export const usePulseWeights = (enabled = true) => useQuery({ queryKey: ['pulse', 'weights'], queryFn: getPulseWeights, enabled, retry: false })
export const useSetPulseWeights = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (weights: Partial<PulseWeights>) => setPulseWeights(weights),
    onSuccess: (data) => {
      queryClient.setQueryData(['pulse', 'weights'], data)
      void queryClient.invalidateQueries({ queryKey: ['pulse', 'topics'] })
    },
  })
}

export const usePulseViewers = (enabled = true) => useQuery({ queryKey: ['pulse', 'viewers'], queryFn: listPulseViewers, enabled, retry: false })
export const useSetPulseViewer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; canView: boolean }) => setPulseViewer(v.userId, v.canView),
    onSuccess: (data) => queryClient.setQueryData(['pulse', 'viewers'], data),
  })
}
export const usePulseSalesforce = (enabled = true) => useQuery({ queryKey: ['pulse', 'salesforce'], queryFn: getPulseSalesforce, enabled, retry: false })
export const useSyncPulseSalesforce = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncPulseSalesforce(),
    onSuccess: (data) => {
      queryClient.setQueryData(['pulse', 'salesforce'], data)
      void queryClient.invalidateQueries({ queryKey: ['pulse', 'topics'] })
      void queryClient.invalidateQueries({ queryKey: ['pulse', 'topic'] })
    },
  })
}
export const usePulseSources = (enabled = true) => useQuery({ queryKey: ['pulse', 'sources'], queryFn: listPulseSources, enabled, retry: false })
// Any change to a source, or reading one, may add signals, so the signal and topic lists are refreshed with it.
const useSourceMutation = <V,>(fn: (v: V) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pulse'] })
    },
  })
}
export const useAddPulseSource = () => useSourceMutation((v: Parameters<typeof addPulseSource>[0]) => addPulseSource(v))
export const useAddPulseOpportunitySource = () => useSourceMutation((v: Parameters<typeof addPulseOpportunitySource>[0]) => addPulseOpportunitySource(v))
export const useUpdatePulseSource = () => useSourceMutation((v: { id: string; patch: Parameters<typeof updatePulseSource>[1] }) => updatePulseSource(v.id, v.patch))
export const useRemovePulseSource = () => useSourceMutation((id: string) => removePulseSource(id))
export const useCheckPulseSource = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => checkPulseSource(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['pulse'] }),
  })
}

export const usePulseTopic = (id: string | undefined, origin?: SignalOrigin, enabled = true) => useQuery({ queryKey: ['pulse', 'topic', id, origin ?? 'any'], queryFn: () => getPulseTopic(id!, origin), enabled: !!id && enabled, retry: false })
export const useSuggestPulseQuestions = () => useMutation({ mutationFn: (v: { topicIds: string[]; method: string }) => suggestPulseQuestions(v.topicIds, v.method) })
export const useCreatePulseProject = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (body: Parameters<typeof createPulseProject>[0]) => createPulseProject(body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }) })
}
/** Where a project came from, when it was started from Pulse topics (only asked for people who can see Pulse). */
export const usePulseOrigin = (projectId: string | undefined, enabled: boolean) => useQuery({ queryKey: ['pulse', 'origin', projectId], queryFn: () => getPulseOrigin(projectId!), enabled: enabled && !!projectId, retry: false })
