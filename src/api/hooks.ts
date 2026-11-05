import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import {
  getAiStatus, listCaseBriefs, getCustomers, getPlatformJourney, getInsightsThemes, getPlatformTheme, listCaseStudies, markThemeReviewed, listMerges, undoMerge, assignPlatformThemeArea, clearPlatformThemeArea, renamePlatformTheme, mergePlatformTheme, findMergeSuggestions, acceptMergeSuggestion, dismissMergeSuggestion, writeRankRationales,
  getBoard, listTickets, createTicket, getDesign, saveDesignItem, captureDesignImage, getMeasure, saveMeasureItem, getStory, moveStory, undoMove, patchStory, saveChecklist,
  changeMemberRole, inviteMember, listAudit, listMembers, removeMember,
  createProject, listAreaProposals, acceptAreaProposal, dismissAreaProposal, deleteProject, listAreas, createArea, updateArea, mergeArea, retireArea, getMe, getSignInOptions, getProject, getSpec, listSpecs, getProjectStage, getTranscripts, listProjects, listTemplates, saveStudy, saveTasks, saveTranscripts, startAnalysis,
  type AuditGroup, type DesignRequest, type MeasureRequest, type MemberRole, type Board, type BoardStory, type ChecklistInput, type CreateProjectRequest, type Priority, type ProjectDetail, type StoryStatus,
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
export const useAreaProposals = () => useQuery({ queryKey: ['areas', 'proposals'], queryFn: listAreaProposals })
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

export const useAudit = (group?: AuditGroup) =>
  useInfiniteQuery({
    queryKey: ['audit', group ?? 'all'],
    queryFn: ({ pageParam }) => listAudit({ group, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: listMembers })
export const useInviteMember = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: { email: string; role: MemberRole }) => inviteMember(input), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members'] }) })
}
export const useChangeMemberRole = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: ({ id, role }: { id: string; role: MemberRole }) => changeMemberRole(id, role), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members'] }) })
}
export const useRemoveMember = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => removeMember(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members'] }) })
}

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
  return useMutation({ mutationFn: (id: string) => deleteProject(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }) })
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
export const usePlatformJourney = () => useQuery({ queryKey: ['insights', 'journey'], queryFn: getPlatformJourney })
export const useCaseBriefs = () => useQuery({ queryKey: ['insights', 'briefs'], queryFn: listCaseBriefs })
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
export const useMeasure = (projectId: string | undefined) => useQuery({ queryKey: ['measure', projectId], queryFn: () => getMeasure(projectId!), enabled: !!projectId })
export const useSaveMeasure = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { storyId: string; version: number; body: MeasureRequest }) => saveMeasureItem(v.storyId, v.version, v.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measure', projectId] }),
  })
}
