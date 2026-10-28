import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import {
  getAiStatus, getCustomers, getPlatformJourney, getInsightsThemes, getPlatformTheme, listCaseStudies,
  getBoard, getDesign, saveDesignItem, getMeasure, saveMeasureItem, getStory, moveStory, undoMove, patchStory, saveChecklist,
  changeMemberRole, inviteMember, listMembers, removeMember,
  createProject, deleteProject, getMe, getProject, getSpec, listSpecs, getProjectStage, getTranscripts, listProjects, listTemplates, saveStudy, saveTasks, saveTranscripts, startAnalysis,
  type DesignRequest, type MeasureRequest, type MemberRole, type Board, type BoardStory, type ChecklistInput, type CreateProjectRequest, type Priority, type ProjectDetail, type StoryStatus,
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
export const useCustomers = () => useQuery({ queryKey: ['insights', 'customers'], queryFn: getCustomers })
export const usePlatformJourney = () => useQuery({ queryKey: ['insights', 'journey'], queryFn: getPlatformJourney })
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

// The Measure table of a project. A save returns the row as it is now; the cached table takes it and counts the results again.
export const useMeasure = (projectId: string | undefined) => useQuery({ queryKey: ['measure', projectId], queryFn: () => getMeasure(projectId!), enabled: !!projectId })
export const useSaveMeasure = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { storyId: string; version: number; body: MeasureRequest }) => saveMeasureItem(v.storyId, v.version, v.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measure', projectId] }),
  })
}
