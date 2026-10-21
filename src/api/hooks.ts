import { useQuery } from '@tanstack/react-query'
import { getMe, listProjects } from './client'

// One hook per operation. Pages bind to these, never to fetch.
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: listProjects })
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: getMe })
