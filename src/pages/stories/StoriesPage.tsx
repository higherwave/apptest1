import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type BoardStory, type CreateTicketInput } from '../../api/client'
import { useBoard, useCreateTicket, useMe, useProject, useStory, useTickets } from '../../api/hooks'
import { StoriesView } from './StoriesView'

// Container: binds the board, the story picked and the tickets to the view, and makes tickets. The tab and the story are in the address
// (?tab=sent, ?open=R6), so a link opens the right one; the Design step's Story link arrives with ?open.
export function StoriesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const project = useProject(projectId)
  const board = useBoard(projectId)
  const tickets = useTickets(projectId)
  const me = useMe()
  const create = useCreateTicket(projectId)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | undefined>()

  const stories = board.data?.stories ?? []
  const sentIds = new Set((tickets.data?.data ?? []).map((t) => t.storyId))
  // Arriving with ?open=R6: that story is selected. Otherwise the first requirement still to prepare, so the page is never empty.
  const wanted = params.get('open')
  const target = wanted ? stories.find((s) => s.key === wanted) : undefined
  const firstId = useMemo(() => {
    const todo = stories.filter((s) => s.kind === 'requirement' && !sentIds.has(s.id)).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))[0]
    return (todo ?? stories[0])?.id ?? null
  }, [board.data, tickets.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => {
    if (target && seen !== target.key) {
      setSeen(target.key)
      setPickedId(target.id)
    }
  }, [target, seen])
  const openId = pickedId && stories.some((s) => s.id === pickedId) ? pickedId : firstId
  const detail = useStory(openId)

  const noBoard = board.error instanceof ApiRequestError && board.error.code === 'no_board'
  const state = noBoard ? 'empty' : board.isError ? 'error' : board.isPending ? 'loading' : 'ready'
  const tab = params.get('tab') === 'sent' ? 'sent' : 'prepare'

  return (
    <StoriesView
      state={state}
      project={project.data}
      stories={stories}
      tickets={tickets.data?.data ?? []}
      tab={tab}
      openId={openId}
      detail={openId ? detail.data : undefined}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      errorText={board.isError && !noBoard ? friendlyMessage(board.error) : tickets.isError ? friendlyMessage(tickets.error) : undefined}
      creating={create.isPending}
      createError={createError}
      linkTo={(story) => `${window.location.origin}/projects/${projectId}/stories?open=${encodeURIComponent(story.key)}`}
      onTab={(next) => {
        const p = new URLSearchParams(params)
        if (next === 'sent') p.set('tab', 'sent')
        else p.delete('tab')
        setParams(p, { replace: true })
      }}
      onOpen={setPickedId}
      onCreate={async (storyId: string, input: CreateTicketInput) => {
        setCreateError(undefined)
        try {
          await create.mutateAsync({ storyId, input })
          return true
        } catch (err) {
          setCreateError(friendlyMessage(err))
          return false
        }
      }}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
      onViewDesign={(story: BoardStory) => navigate(`/projects/${projectId}/design?open=${encodeURIComponent(story.key)}`)}
    />
  )
}
