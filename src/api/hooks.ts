import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import {
  createProject, deleteProject, getMe, getProject, getProjectStage, listProjects, listTemplates, saveParticipants, saveStudy, saveTasks,
  type CreateProjectRequest, type ProjectDetail,
} from './client'
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
export const useSaveParticipants = (id: string) => useSave(id, saveParticipants)
export const useSaveTasks = (id: string) => useSave(id, saveTasks)
