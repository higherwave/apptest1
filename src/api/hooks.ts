import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { createProject, deleteProject, getMe, listProjects, listTemplates, type CreateProjectRequest } from './client'
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
